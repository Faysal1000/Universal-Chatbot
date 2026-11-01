import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE, type Database } from '../../../database/database.tokens.js';
import { conversationSummaries } from '../../../database/schema.js';

export type ConversationSummaryRecord = typeof conversationSummaries.$inferSelect;
export type NewConversationSummaryRecord = typeof conversationSummaries.$inferInsert;

@Injectable()
export class ConversationSummariesRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async find(conversationId: string): Promise<ConversationSummaryRecord | undefined> {
    const [summary] = await this.database
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, conversationId));
    return summary;
  }

  async upsert(summary: NewConversationSummaryRecord): Promise<void> {
    await this.database
      .insert(conversationSummaries)
      .values(summary)
      .onConflictDoUpdate({
        target: conversationSummaries.conversationId,
        set: { ...summary, updatedAt: new Date() },
      });
  }
}
