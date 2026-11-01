import { Inject, Injectable } from '@nestjs/common';
import { and, eq, exists, ilike, or, type SQL, sql } from 'drizzle-orm';

import { keysetBefore, keysetOrder, type KeysetPosition } from '../../../common/pagination/keyset-cursor.js';
import { DATABASE, type Database } from '../../../database/database.tokens.js';
import { chatMessages, conversations } from '../../../database/schema.js';
import { escapeLikePattern } from '../../../database/like-pattern.js';

export type ConversationRecord = typeof conversations.$inferSelect;

export interface ConversationListFilter {
  readonly visitorSessionId?: string;
  /** Matches the title or any message text. */
  readonly search?: string;
  /** Conversations updated strictly before this position (keyset on updatedAt, id). */
  readonly before?: KeysetPosition;
  readonly limit: number;
}

@Injectable()
export class ConversationsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async insert(
    visitorSessionId: string,
    title: string,
    isTitleGenerated: boolean,
  ): Promise<ConversationRecord> {
    const [inserted] = await this.database
      .insert(conversations)
      .values({ visitorSessionId, title, isTitleGenerated })
      .returning();
    if (inserted === undefined) throw new Error('Inserting a conversation returned no row');
    return inserted;
  }

  async findById(conversationId: string): Promise<ConversationRecord | undefined> {
    const [conversation] = await this.database
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    return conversation;
  }

  async findOwned(conversationId: string, visitorSessionId: string): Promise<ConversationRecord | undefined> {
    const [conversation] = await this.database
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.visitorSessionId, visitorSessionId)));
    return conversation;
  }

  /** Most recently updated first. */
  async list(filter: ConversationListFilter): Promise<ConversationRecord[]> {
    return this.database
      .select()
      .from(conversations)
      .where(and(...buildListConditions(filter)))
      .orderBy(...keysetOrder(conversations.updatedAt, conversations.id))
      .limit(filter.limit);
  }

  async rename(conversationId: string, title: string): Promise<ConversationRecord | undefined> {
    const [renamed] = await this.database
      .update(conversations)
      .set({ title, isTitleGenerated: false })
      .where(eq(conversations.id, conversationId))
      .returning();
    return renamed;
  }

  async setGeneratedTitle(conversationId: string, title: string): Promise<void> {
    await this.database
      .update(conversations)
      .set({ title })
      .where(and(eq(conversations.id, conversationId), eq(conversations.isTitleGenerated, true)));
  }

  /** Records a finished turn: newest preview, one more turn, and a fresh `updatedAt`. */
  async recordTurn(
    conversationId: string,
    lastMessagePreview: string,
  ): Promise<ConversationRecord | undefined> {
    const [updated] = await this.database
      .update(conversations)
      .set({ lastMessagePreview, turnCount: sql`${conversations.turnCount} + 1`, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning();
    return updated;
  }

  async delete(conversationId: string): Promise<void> {
    await this.database.delete(conversations).where(eq(conversations.id, conversationId));
  }

  async count(): Promise<number> {
    const [result] = await this.database.select({ total: sql<number>`count(*)::int` }).from(conversations);
    return result?.total ?? 0;
  }
}

function buildListConditions(filter: ConversationListFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.visitorSessionId !== undefined) {
    conditions.push(eq(conversations.visitorSessionId, filter.visitorSessionId));
  }
  if (filter.search !== undefined) {
    const pattern = `%${escapeLikePattern(filter.search)}%`;
    const matchingMessage = exists(
      sql`SELECT 1 FROM ${chatMessages} WHERE ${chatMessages.conversationId} = ${conversations.id} AND ${chatMessages.content} ILIKE ${pattern}`,
    );
    const searchCondition = or(ilike(conversations.title, pattern), matchingMessage);
    if (searchCondition !== undefined) conditions.push(searchCondition);
  }
  if (filter.before !== undefined)
    conditions.push(keysetBefore(conversations.updatedAt, conversations.id, filter.before));
  return conditions;
}
