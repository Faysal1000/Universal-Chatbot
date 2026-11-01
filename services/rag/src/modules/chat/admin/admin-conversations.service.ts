import { Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../common/errors/application-error.js';
import { decodeKeysetCursor, toPage } from '../../../common/pagination/keyset-cursor.js';
import { ChatMessagePresenter } from '../conversations/chat-message-presenter.js';
import { presentConversation } from '../conversations/conversation-presenter.js';
import { ChatMessagesRepository } from '../persistence/chat-messages.repository.js';
import { type ChatTurnRecord, ChatTurnsRepository } from '../persistence/chat-turns.repository.js';
import { ConversationSummariesRepository } from '../persistence/conversation-summaries.repository.js';
import { type ConversationRecord, ConversationsRepository } from '../persistence/conversations.repository.js';
import { retrievalTraceSchema } from '../../retrieval/retrieval-trace.js';
import {
  FEEDBACK_EXCERPT_LENGTH,
  MessageFeedbackRepository,
} from '../persistence/message-feedback.repository.js';
import { RetrievalTracesRepository } from '../persistence/retrieval-traces.repository.js';
import type {
  AdminConversationDetailView,
  AdminConversationListQuery,
  AdminConversationView,
  AdminFeedbackView,
  AdminTurnView,
} from './admin-conversations.schemas.js';

/** Read-only view of every visitor conversation, with what retrieval did per turn. */
@Injectable()
export class AdminConversationsService {
  constructor(
    private readonly conversationsRepository: ConversationsRepository,
    private readonly chatTurnsRepository: ChatTurnsRepository,
    private readonly chatMessagesRepository: ChatMessagesRepository,
    private readonly conversationSummariesRepository: ConversationSummariesRepository,
    private readonly retrievalTracesRepository: RetrievalTracesRepository,
    private readonly messageFeedbackRepository: MessageFeedbackRepository,
    private readonly chatMessagePresenter: ChatMessagePresenter,
  ) {}

  async list(
    query: AdminConversationListQuery,
  ): Promise<{ items: AdminConversationView[]; nextCursor: string | null }> {
    const rows = await this.conversationsRepository.list({
      ...(query.visitorSessionId === undefined ? {} : { visitorSessionId: query.visitorSessionId }),
      ...(query.q === undefined ? {} : { search: query.q }),
      ...(query.cursor === undefined ? {} : { before: decodeKeysetCursor(query.cursor) }),
      limit: query.limit + 1,
    });
    return toPage(rows, query.limit, presentAdminConversation, (conversation) => ({
      timestamp: conversation.updatedAt,
      id: conversation.id,
    }));
  }

  async describe(conversationId: string): Promise<AdminConversationDetailView> {
    const conversation = await this.conversationsRepository.findById(conversationId);
    if (conversation === undefined) {
      throw new ApplicationError(404, 'not_found', 'No conversation has this id.');
    }
    const [turns, messages, summary] = await Promise.all([
      this.chatTurnsRepository.listForConversation(conversationId),
      this.chatMessagesRepository.listConversationMessages(conversationId),
      this.conversationSummariesRepository.find(conversationId),
    ]);
    const [messageViews, traces] = await Promise.all([
      this.chatMessagePresenter.present(messages),
      this.retrievalTracesRepository.findByTurns(turns.map((turn) => turn.id)),
    ]);
    return {
      ...presentAdminConversation(conversation),
      summary:
        summary === undefined
          ? null
          : {
              text: summary.summaryText,
              coveredThroughMessageId: summary.coveredMessageId,
              updatedAt: summary.updatedAt.toISOString(),
            },
      turns: turns.map((turn) =>
        presentAdminTurn(
          turn,
          messageViews.filter((message) => message.turnId === turn.id),
          traces.get(turn.id) ?? null,
        ),
      ),
    };
  }

  async listFeedback(limit: number): Promise<AdminFeedbackView[]> {
    const rows = await this.messageFeedbackRepository.listRecent(limit);
    return rows.map((row) => ({
      messageId: row.feedback.messageId,
      conversationId: row.conversationId,
      turnId: row.turnId,
      rating: row.feedback.rating,
      comment: row.feedback.comment,
      questionExcerpt: excerptOf(row.questionStart),
      answerExcerpt: excerptOf(row.answerStart),
      createdAt: row.feedback.createdAt.toISOString(),
    }));
  }
}

function presentAdminConversation(conversation: ConversationRecord): AdminConversationView {
  return {
    ...presentConversation(conversation),
    visitorSessionId: conversation.visitorSessionId,
    turnCount: conversation.turnCount,
  };
}

function presentAdminTurn(
  turn: ChatTurnRecord,
  messages: AdminTurnView['messages'],
  retrievalTrace: Record<string, unknown> | null,
): AdminTurnView {
  return {
    id: turn.id,
    status: turn.status,
    finishReason: turn.finishReason,
    failureCode: turn.failureCode,
    rewrittenQueries: turn.rewrittenQueries,
    chatbotSettingsVersion: turn.chatbotSettingsVersion,
    servedByModel: turn.servedByModel,
    usage: {
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      reasoningTokens: turn.reasoningTokens,
    },
    timings: { ttftMs: turn.timeToFirstTokenMilliseconds, totalMs: turn.totalMilliseconds },
    createdAt: turn.createdAt.toISOString(),
    messages,
    retrievalTrace: readableTraceOf(retrievalTrace),
  };
}

/** A trace in a shape this version cannot read is left out rather than failing the page. */
function readableTraceOf(storedTrace: Record<string, unknown> | null): AdminTurnView['retrievalTrace'] {
  if (storedTrace === null) return null;
  const parsed = retrievalTraceSchema.safeParse(storedTrace);
  return parsed.success ? parsed.data : null;
}

function excerptOf(loadedStart: string): string {
  const singleLine = loadedStart.replace(/\s+/g, ' ').trim();
  return loadedStart.length > FEEDBACK_EXCERPT_LENGTH
    ? `${singleLine.slice(0, FEEDBACK_EXCERPT_LENGTH - 1)}…`
    : singleLine;
}
