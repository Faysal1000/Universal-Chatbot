import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt, lte, ne, notInArray } from 'drizzle-orm';

import { DATABASE, type Database } from '../../../database/database.tokens.js';
import { type ChatMessageStatus, chatMessages, chatTurns, conversations } from '../../../database/schema.js';
import { HIDDEN_TURN_STATUSES } from './chat-turns.repository.js';

export type ChatMessageRecord = typeof chatMessages.$inferSelect;

export interface AssistantMessageResult {
  readonly content: string;
  readonly reasoning: string | null;
  readonly status: Exclude<ChatMessageStatus, 'streaming'>;
  readonly estimatedTokenCount: number;
}

@Injectable()
export class ChatMessagesRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async insertAssistantPlaceholder(conversationId: string, turnId: string): Promise<ChatMessageRecord> {
    const [inserted] = await this.database
      .insert(chatMessages)
      .values({ conversationId, turnId, role: 'assistant', content: '', status: 'streaming' })
      .returning();
    if (inserted === undefined) throw new Error('Inserting an assistant message returned no row');
    return inserted;
  }

  async completeAssistantMessage(messageId: string, result: AssistantMessageResult): Promise<void> {
    await this.database.update(chatMessages).set(result).where(eq(chatMessages.id, messageId));
  }

  async findById(messageId: string): Promise<ChatMessageRecord | undefined> {
    const [message] = await this.database.select().from(chatMessages).where(eq(chatMessages.id, messageId));
    return message;
  }

  /** A message together with the visitor session owning its conversation. */
  async findWithOwner(
    messageId: string,
  ): Promise<{ message: ChatMessageRecord; visitorSessionId: string } | undefined> {
    const [row] = await this.database
      .select({ message: chatMessages, visitorSessionId: conversations.visitorSessionId })
      .from(chatMessages)
      .innerJoin(conversations, eq(conversations.id, chatMessages.conversationId))
      .where(eq(chatMessages.id, messageId));
    return row;
  }

  /** Every message of a conversation, hidden turns included (admin view). */
  async listConversationMessages(conversationId: string): Promise<ChatMessageRecord[]> {
    return this.database
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(asc(chatMessages.sequenceNumber));
  }

  async listTurnMessages(turnId: string): Promise<ChatMessageRecord[]> {
    return this.database
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.turnId, turnId))
      .orderBy(asc(chatMessages.sequenceNumber));
  }

  /**
   * Visible, finished messages before `beforeSequenceNumber`, newest first (the caller
   * reverses a page into chronological order).
   */
  async listVisibleBefore(
    conversationId: string,
    beforeSequenceNumber: number | undefined,
    limit: number,
  ): Promise<ChatMessageRecord[]> {
    const rows = await this.database
      .select({ message: chatMessages })
      .from(chatMessages)
      .innerJoin(chatTurns, eq(chatTurns.id, chatMessages.turnId))
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          notInArray(chatTurns.status, [...HIDDEN_TURN_STATUSES]),
          ne(chatMessages.status, 'streaming'),
          ...(beforeSequenceNumber === undefined
            ? []
            : [lt(chatMessages.sequenceNumber, beforeSequenceNumber)]),
        ),
      )
      .orderBy(desc(chatMessages.sequenceNumber))
      .limit(limit);
    return rows.map((row) => row.message);
  }

  /** Messages of finished earlier turns after `afterSequenceNumber`: the material for memory. */
  async loadHistory(
    conversationId: string,
    afterSequenceNumber: number,
    excludedTurnId: string | null,
    throughSequenceNumber?: number,
  ): Promise<ChatMessageRecord[]> {
    const rows = await this.database
      .select({ message: chatMessages })
      .from(chatMessages)
      .innerJoin(chatTurns, eq(chatTurns.id, chatMessages.turnId))
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          gt(chatMessages.sequenceNumber, afterSequenceNumber),
          ...(throughSequenceNumber === undefined
            ? []
            : [lte(chatMessages.sequenceNumber, throughSequenceNumber)]),
          ...(excludedTurnId === null ? [] : [ne(chatMessages.turnId, excludedTurnId)]),
          inArray(chatTurns.status, ['completed', 'cancelled']),
          inArray(chatMessages.status, ['complete', 'stopped']),
        ),
      )
      .orderBy(asc(chatMessages.sequenceNumber));
    return rows.map((row) => row.message);
  }
}
