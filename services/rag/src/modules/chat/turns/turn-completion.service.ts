import { Injectable, Logger } from '@nestjs/common';

import { ApplicationError } from '../../../common/errors/application-error.js';
import { UpstreamServiceError } from '../../../common/outbound-http/upstream-service-error.js';
import { removeCitationMarkers } from '../../../domain/chat/citation-markers.js';
import { titleFromFirstMessage } from '../../../domain/chat/conversation-title.js';
import { TokenEstimator } from '../../../domain/text/token-estimator.js';
import { QueueProducerService } from '../../../queue/queue-producer.service.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { DailyTokenBudgetService } from '../../public-access/daily-token-budget.service.js';
import { ChatMessagesRepository } from '../persistence/chat-messages.repository.js';
import { ChatTurnsRepository } from '../persistence/chat-turns.repository.js';
import { type ConversationRecord, ConversationsRepository } from '../persistence/conversations.repository.js';
import { conversationSummaryJobId, type SummariseConversationPayload } from '../summaries/summary-jobs.js';
import { presentConversation } from '../conversations/conversation-presenter.js';
import type { CitationView, TurnFinishReason } from './turn-stream-events.js';
import { TurnEventLog } from './turn-event-log.js';
import type { GeneratedAnswer, TurnExecution } from './turn-execution.js';

const PREVIEW_LENGTH = 140;

/** Stores how a turn ended and announces it as the final events of its stream. */
@Injectable()
export class TurnCompletionService {
  private readonly logger = new Logger(TurnCompletionService.name);

  constructor(
    private readonly turnEventLog: TurnEventLog,
    private readonly chatTurnsRepository: ChatTurnsRepository,
    private readonly chatMessagesRepository: ChatMessagesRepository,
    private readonly conversationsRepository: ConversationsRepository,
    private readonly dailyTokenBudget: DailyTokenBudgetService,
    private readonly queueProducer: QueueProducerService,
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  /**
   * A finished (or stopped) answer: turn, budget, message, conversation, then `message.completed`.
   * Returns false, recording only the spending, when the turn was superseded meanwhile.
   */
  async complete(
    execution: TurnExecution,
    answer: GeneratedAnswer,
    citations: readonly CitationView[],
    summariseThroughSequenceNumber: number | null,
  ): Promise<boolean> {
    const totalMilliseconds = Math.round(performance.now() - execution.startedAtMilliseconds);
    const isRecorded = await this.chatTurnsRepository.recordOutcome(execution.turnId, {
      status: answer.finishReason === 'cancelled' ? 'cancelled' : 'completed',
      finishReason: answer.finishReason,
      servedByModel: answer.servedByModel,
      inputTokens: answer.inputTokens,
      outputTokens: answer.outputTokens,
      reasoningTokens: answer.reasoningTokens,
      timeToFirstTokenMilliseconds: answer.timeToFirstTokenMilliseconds,
      totalMilliseconds,
    });
    await this.dailyTokenBudget.recordSpending(answer.inputTokens + answer.outputTokens);
    if (!isRecorded) return false;
    if (execution.settings.showSources) {
      await this.turnEventLog.append(execution.turnId, 'answer.citations', { citations: [...citations] });
    }
    await this.chatMessagesRepository.completeAssistantMessage(execution.assistantMessageId, {
      content: answer.content,
      reasoning: answer.reasoning,
      status: answer.finishReason === 'cancelled' ? 'stopped' : 'complete',
      estimatedTokenCount: this.tokenEstimator.estimateMessage(answer.content),
    });
    await this.announceConversationUpdate(execution, answer.content);
    if (summariseThroughSequenceNumber !== null) {
      await this.requestSummary(execution, summariseThroughSequenceNumber);
    }
    await this.turnEventLog.append(execution.turnId, 'message.completed', {
      assistantMessageId: execution.assistantMessageId,
      finishReason: answer.finishReason satisfies TurnFinishReason,
      usage: { inputTokens: answer.inputTokens, outputTokens: answer.outputTokens },
      timings: {
        ttftMs: answer.timeToFirstTokenMilliseconds ?? totalMilliseconds,
        totalMs: totalMilliseconds,
      },
    });
    return true;
  }

  /** A turn that failed: what was streamed stays, marked as an error. */
  async fail(execution: TurnExecution, error: unknown, partialContent: string): Promise<void> {
    const failure = describeFailure(error);
    if (failure.isUnexpected) this.logger.error({ err: error, turnId: execution.turnId }, 'Turn failed');
    const isRecorded = await this.chatTurnsRepository.recordOutcome(execution.turnId, {
      status: 'failed',
      finishReason: null,
      failureCode: failure.code,
      servedByModel: null,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      timeToFirstTokenMilliseconds: null,
      totalMilliseconds: Math.round(performance.now() - execution.startedAtMilliseconds),
    });
    if (!isRecorded) return;
    await this.chatMessagesRepository.completeAssistantMessage(execution.assistantMessageId, {
      content: partialContent,
      reasoning: null,
      status: 'error',
      estimatedTokenCount: this.tokenEstimator.estimateMessage(partialContent),
    });
    await this.turnEventLog.append(execution.turnId, 'error', {
      code: failure.code,
      message: failure.message,
      retryable: failure.isRetryable,
      ...(failure.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: failure.retryAfterSeconds }),
    });
  }

  private async announceConversationUpdate(execution: TurnExecution, answerContent: string): Promise<void> {
    const conversation = execution.conversation;
    if (conversation.turnCount === 0 && conversation.isTitleGenerated) {
      const [firstMessage] = execution.userMessages;
      await this.conversationsRepository.setGeneratedTitle(
        conversation.id,
        titleFromFirstMessage(firstMessage?.content ?? ''),
      );
    }
    const updated = await this.conversationsRepository.recordTurn(conversation.id, previewOf(answerContent));
    if (updated !== undefined) await this.emitConversationUpdated(execution.turnId, updated);
  }

  private async emitConversationUpdated(turnId: string, conversation: ConversationRecord): Promise<void> {
    await this.turnEventLog.append(turnId, 'conversation.updated', {
      conversation: presentConversation(conversation),
    });
  }

  private async requestSummary(execution: TurnExecution, throughSequenceNumber: number): Promise<void> {
    const payload: SummariseConversationPayload = {
      conversationId: execution.conversation.id,
      throughSequenceNumber,
    };
    try {
      await this.queueProducer.enqueue(QUEUE_NAMES.conversationSummary, 'summarise', payload, {
        jobId: conversationSummaryJobId(payload),
        ...(execution.requestId === undefined ? {} : { requestId: execution.requestId }),
      });
    } catch (error: unknown) {
      // The next turn asks again; a missing summary only costs prompt space.
      this.logger.warn({ err: error }, 'Could not enqueue a conversation summary');
    }
  }
}

/** A list preview has nowhere to show sources, so `[n]` markers are dropped. */
function previewOf(text: string): string {
  const singleLine = removeCitationMarkers(text).replace(/\s+/g, ' ').trim();
  return singleLine.length <= PREVIEW_LENGTH ? singleLine : `${singleLine.slice(0, PREVIEW_LENGTH - 1)}…`;
}

interface TurnFailure {
  readonly code: string;
  readonly message: string;
  readonly isRetryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly isUnexpected: boolean;
}

function describeFailure(error: unknown): TurnFailure {
  if (error instanceof UpstreamServiceError) {
    return {
      code: 'upstream_failed',
      message: 'The assistant is temporarily unavailable. Please try again.',
      isRetryable: error.details.isRetryable,
      ...(error.details.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.details.retryAfterSeconds }),
      isUnexpected: false,
    };
  }
  if (error instanceof ApplicationError) {
    return {
      code: error.code,
      message: error.clientMessage,
      isRetryable: error.httpStatus >= 500,
      ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
      isUnexpected: false,
    };
  }
  return {
    code: 'internal_error',
    message: 'Something went wrong while answering. Please try again.',
    isRetryable: true,
    isUnexpected: true,
  };
}
