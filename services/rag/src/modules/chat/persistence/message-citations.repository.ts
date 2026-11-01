import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';

import { DATABASE, type Database } from '../../../database/database.tokens.js';
import { conversations, chatMessages, messageCitations } from '../../../database/schema.js';

export type MessageCitationRecord = typeof messageCitations.$inferSelect;
export type NewMessageCitationRecord = typeof messageCitations.$inferInsert;

@Injectable()
export class MessageCitationsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async insertMany(citations: readonly NewMessageCitationRecord[]): Promise<MessageCitationRecord[]> {
    if (citations.length === 0) return [];
    return this.database
      .insert(messageCitations)
      .values([...citations])
      .returning();
  }

  async listForMessages(messageIds: readonly string[]): Promise<MessageCitationRecord[]> {
    if (messageIds.length === 0) return [];
    return this.database
      .select()
      .from(messageCitations)
      .where(inArray(messageCitations.messageId, [...messageIds]))
      .orderBy(asc(messageCitations.marker));
  }

  async findWithOwner(
    citationId: string,
  ): Promise<{ citation: MessageCitationRecord; visitorSessionId: string } | undefined> {
    const [row] = await this.database
      .select({ citation: messageCitations, visitorSessionId: conversations.visitorSessionId })
      .from(messageCitations)
      .innerJoin(chatMessages, eq(chatMessages.id, messageCitations.messageId))
      .innerJoin(conversations, eq(conversations.id, chatMessages.conversationId))
      .where(eq(messageCitations.id, citationId));
    return row;
  }
}
