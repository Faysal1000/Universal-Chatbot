import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ApplicationError } from '../../../common/errors/application-error.js';
import { uniqueViolationConstraintOf } from '../../../database/database-errors.js';
import { TokenEstimator } from '../../../domain/text/token-estimator.js';
import { ChatbotSettingsService } from '../../chatbot-settings/chatbot-settings.service.js';
import { DailyTokenBudgetService } from '../../public-access/daily-token-budget.service.js';
import { PublicRateLimitsService } from '../../public-access/public-rate-limits.service.js';
import type { VisitorPrincipal } from '../../public-access/visitor-principal.js';
import { MAX_MESSAGE_CHARS_CEILING, PUBLIC_CHAT_LIMITS } from '../public-chat-limits.js';
import { ChatAttachmentsRepository } from '../persistence/chat-attachments.repository.js';
import { ChatMessagesRepository } from '../persistence/chat-messages.repository.js';
import { type ChatTurnRecord, ChatTurnsRepository } from '../persistence/chat-turns.repository.js';
import { type ConversationRecord, ConversationsRepository } from '../persistence/conversations.repository.js';
import { RunningTurnsRegistry } from './running-turns.registry.js';
import { TurnControl } from './turn-control.js';
import { TurnEventLog } from './turn-event-log.js';
import type { TurnUserMessage } from './turn-execution.js';
import { TurnRunnerService } from './turn-runner.service.js';

export const submitTurnRequestSchema = z
  .object({
    turnId: z.uuid(),
    messages: z
      .array(
        z.object({
          clientMessageId: z.string().trim().min(1).max(100),
          content: z
            .string()
            .max(MAX_MESSAGE_CHARS_CEILING)
            .refine((text) => !text.includes('\u0000'), 'Must not contain NUL characters.'),
          attachmentIds: z.array(z.uuid()).max(PUBLIC_CHAT_LIMITS.maxImagesPerTurn),
        }),
      )
      .min(1)
      .max(PUBLIC_CHAT_LIMITS.maxMessagesPerTurn),
    replacesTurnId: z.uuid().nullable().default(null),
  })
  .refine(
    (request) =>
      request.messages.every((message) => message.content.trim() !== '' || message.attachmentIds.length > 0),
    {
      message: 'Every message needs text or an image.',
      path: ['messages'],
    },
  )
  .refine(
    (request) =>
      request.messages.reduce((total, message) => total + message.attachmentIds.length, 0) <=
      PUBLIC_CHAT_LIMITS.maxImagesPerTurn,
    { message: `At most ${PUBLIC_CHAT_LIMITS.maxImagesPerTurn} images per turn.`, path: ['messages'] },
  );
export type SubmitTurnRequest = z.infer<typeof submitTurnRequestSchema>;

export interface TurnSubmission {
  readonly conversationId: string;
  readonly visitor: VisitorPrincipal;
  readonly idempotencyKey: string | undefined;
  readonly request: SubmitTurnRequest;
  readonly requestId: string | undefined;
}

/**
 * Accepts a batch of visitor messages as one turn: enforces idempotency, the one-turn-
 * at-a-time rule (superseding a turn that has not started answering), replacement of
 * the latest turn, limits and the token budget, then starts answering in the background.
 */
@Injectable()
export class SubmitTurnService {
  constructor(
    private readonly conversationsRepository: ConversationsRepository,
    private readonly chatTurnsRepository: ChatTurnsRepository,
    private readonly chatMessagesRepository: ChatMessagesRepository,
    private readonly chatAttachmentsRepository: ChatAttachmentsRepository,
    private readonly chatbotSettings: ChatbotSettingsService,
    private readonly rateLimits: PublicRateLimitsService,
    private readonly dailyTokenBudget: DailyTokenBudgetService,
    private readonly turnControl: TurnControl,
    private readonly runningTurns: RunningTurnsRegistry,
    private readonly turnEventLog: TurnEventLog,
    private readonly turnRunner: TurnRunnerService,
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  /** Returns the turn whose event log the caller should stream (new, or replayed). */
  async submit(submission: TurnSubmission): Promise<string> {
    const { request } = submission;
    assertIdempotencyKeyMatches(submission.idempotencyKey, request.turnId);
    const conversation = await this.findConversationOrFail(submission);
    const existingTurn = await this.chatTurnsRepository.findById(request.turnId);
    if (existingTurn !== undefined) return replayableTurnId(existingTurn, conversation, request);
    await this.dailyTokenBudget.assertBudgetLeft();
    await this.rateLimits.consumeTurn(submission.visitor);
    const settings = await this.chatbotSettings.getActive();
    if (conversation.turnCount >= settings.maxTurnsPerConversation) {
      throw new ApplicationError(
        409,
        'conversation_limit_reached',
        'This conversation is full. Start a new one.',
      );
    }
    assertMessagesFit(request, settings.maxMessageChars);
    await this.assertAttachmentsUsable(submission);
    const supersedeTurnId = await this.findSupersedableTurnId(conversation.id);
    if (request.replacesTurnId !== null) {
      await this.assertReplaceable(conversation.id, request.replacesTurnId);
    }
    const userMessages = await this.storeTurn(submission, supersedeTurnId);
    const assistantMessage = await this.chatMessagesRepository.insertAssistantPlaceholder(
      conversation.id,
      request.turnId,
    );
    if (supersedeTurnId !== undefined) await this.interruptSuperseded(supersedeTurnId, request.turnId);
    await this.turnEventLog.append(request.turnId, 'message.started', {
      turnId: request.turnId,
      conversationId: conversation.id,
      assistantMessageId: assistantMessage.id,
      userMessages: userMessages.map((message) => ({
        clientMessageId: message.clientMessageId,
        id: message.id,
      })),
    });
    await this.turnEventLog.append(request.turnId, 'status', { stage: 'queued' });
    void this.turnRunner.run({
      turnId: request.turnId,
      conversation,
      assistantMessageId: assistantMessage.id,
      userMessages,
      settings,
      requestId: submission.requestId,
      abortSignal: this.runningTurns.register(request.turnId),
      startedAtMilliseconds: performance.now(),
    });
    return request.turnId;
  }

  private async findConversationOrFail(submission: TurnSubmission): Promise<ConversationRecord> {
    const conversation = await this.conversationsRepository.findOwned(
      submission.conversationId,
      submission.visitor.visitorSessionId,
    );
    if (conversation === undefined) {
      throw new ApplicationError(404, 'not_found', 'No conversation has this id.');
    }
    return conversation;
  }

  private async assertAttachmentsUsable(submission: TurnSubmission): Promise<void> {
    const attachmentIds = submission.request.messages.flatMap((message) => message.attachmentIds);
    const attachments = await this.chatAttachmentsRepository.findByIds(attachmentIds);
    const areAllUsable =
      attachments.length === new Set(attachmentIds).size &&
      attachments.every(
        (attachment) =>
          attachment.visitorSessionId === submission.visitor.visitorSessionId &&
          attachment.messageId === null &&
          (attachment.expiresAt === null || attachment.expiresAt > new Date()),
      );
    if (!areAllUsable) {
      throw new ApplicationError(422, 'validation_failed', 'The request is invalid.', {
        fieldErrors: [
          { field: 'messages.attachmentIds', message: 'Unknown, expired or already used attachment.' },
        ],
      });
    }
  }

  /** A running turn that has not streamed an answer yet is merged into the new one. */
  private async findSupersedableTurnId(conversationId: string): Promise<string | undefined> {
    const activeTurn = await this.chatTurnsRepository.findActive(conversationId);
    if (activeTurn === undefined) return undefined;
    if (await this.turnControl.hasAnswerStarted(activeTurn.id)) throw turnInProgressError();
    return activeTurn.id;
  }

  private async assertReplaceable(conversationId: string, replacesTurnId: string): Promise<void> {
    const latestTurn = await this.chatTurnsRepository.findLatestVisible(conversationId);
    const isLatestFinishedTurn =
      latestTurn?.id === replacesTurnId && latestTurn.status !== 'pending' && latestTurn.status !== 'running';
    if (!isLatestFinishedTurn) {
      throw new ApplicationError(
        409,
        'turn_not_replaceable',
        'Only the latest finished turn can be replaced.',
      );
    }
  }

  private async storeTurn(
    submission: TurnSubmission,
    supersedeTurnId: string | undefined,
  ): Promise<TurnUserMessage[]> {
    const { request, conversationId } = submission;
    try {
      const started = await this.chatTurnsRepository.start({
        turn: {
          id: request.turnId,
          conversationId,
          requestBodyHash: hashRequestBody(request),
          replacesTurnId: request.replacesTurnId,
        },
        userMessages: request.messages.map((message) => ({
          conversationId,
          clientMessageId: message.clientMessageId,
          content: message.content.trim(),
          estimatedTokenCount: this.tokenEstimator.estimateMessage(message.content),
        })),
        ...(supersedeTurnId === undefined ? {} : { supersedeTurnId }),
        ...(request.replacesTurnId === null ? {} : { replaceTurnId: request.replacesTurnId }),
        attachmentLinks: request.messages.map((message) => ({
          clientMessageId: message.clientMessageId,
          attachmentIds: message.attachmentIds,
        })),
      });
      if (started === undefined) throw turnInProgressError();
    } catch (error: unknown) {
      throw describeUniqueViolation(error) ?? error;
    }
    return this.loadTurnUserMessages(request.turnId);
  }

  /** The turn's user messages, including any taken over from a superseded turn. */
  private async loadTurnUserMessages(turnId: string): Promise<TurnUserMessage[]> {
    const messages = (await this.chatMessagesRepository.listTurnMessages(turnId)).filter(
      (message) => message.role === 'user',
    );
    const attachments = await this.chatAttachmentsRepository.listForMessages(
      messages.map((message) => message.id),
    );
    return messages.map((message) => ({
      id: message.id,
      clientMessageId: message.clientMessageId ?? message.id,
      content: message.content,
      attachments: attachments.filter((attachment) => attachment.messageId === message.id),
    }));
  }

  private async interruptSuperseded(supersededTurnId: string, supersedingTurnId: string): Promise<void> {
    const interruption = { kind: 'superseded' as const, supersededByTurnId: supersedingTurnId };
    if (!this.runningTurns.interrupt(supersededTurnId, interruption)) {
      await this.turnControl.requestInterruption(supersededTurnId, interruption);
    }
  }
}

function assertIdempotencyKeyMatches(idempotencyKey: string | undefined, turnId: string): void {
  if (idempotencyKey !== undefined && idempotencyKey !== turnId) {
    throw new ApplicationError(422, 'validation_failed', 'The request is invalid.', {
      fieldErrors: [{ field: 'Idempotency-Key', message: 'Must equal turnId.' }],
    });
  }
}

/** A resubmitted turn replays its stream when it is the same request; anything else conflicts. */
function replayableTurnId(
  existingTurn: ChatTurnRecord,
  conversation: ConversationRecord,
  request: SubmitTurnRequest,
): string {
  if (
    existingTurn.conversationId !== conversation.id ||
    existingTurn.requestBodyHash !== hashRequestBody(request)
  ) {
    throw new ApplicationError(
      409,
      'idempotency_conflict',
      'This turn id was already used for a different request.',
    );
  }
  return existingTurn.id;
}

function hashRequestBody(request: SubmitTurnRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

/** Concurrent submissions surface as unique violations; each constraint means something else. */
function describeUniqueViolation(error: unknown): ApplicationError | undefined {
  const constraint = uniqueViolationConstraintOf(error);
  if (constraint === undefined) return undefined;
  if (constraint === 'chat_turns_single_active_per_conversation') return turnInProgressError();
  return new ApplicationError(
    409,
    'idempotency_conflict',
    'This turn or one of its messages was already submitted in another request.',
  );
}

function turnInProgressError(): ApplicationError {
  return new ApplicationError(
    409,
    'turn_in_progress',
    'A reply is still being written. Wait for it to finish.',
  );
}

/** The admin's message length limit; the chat input enforces it first, so only modified clients hit this. */
function assertMessagesFit(request: SubmitTurnRequest, maxMessageChars: number): void {
  if (request.messages.every((message) => message.content.length <= maxMessageChars)) return;
  throw new ApplicationError(
    422,
    'message_too_long',
    `Messages can be at most ${maxMessageChars} characters.`,
    {
      fieldErrors: [{ field: 'messages', message: `At most ${maxMessageChars} characters per message.` }],
    },
  );
}
