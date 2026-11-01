import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, inArray, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../../../database/database.tokens.js';
import { type FeedbackRating, chatMessages, messageFeedback } from '../../../database/schema.js';

export type MessageFeedbackRecord = typeof messageFeedback.$inferSelect;

/** Characters of question and answer loaded per rating; one more than shown reveals a cut. */
export const FEEDBACK_EXCERPT_LENGTH = 280;

export interface RatedAnswer {
  readonly feedback: MessageFeedbackRecord;
  readonly conversationId: string;
  readonly turnId: string;
  /** The turn's visitor messages, joined, cut to `FEEDBACK_EXCERPT_LENGTH + 1` characters. */
  readonly questionStart: string;
  /** The rated answer, cut the same way. */
  readonly answerStart: string;
}

@Injectable()
export class MessageFeedbackRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** One rating per message; rating again replaces it. */
  async upsert(messageId: string, rating: FeedbackRating, comment: string | null): Promise<void> {
    await this.database
      .insert(messageFeedback)
      .values({ messageId, rating, comment })
      .onConflictDoUpdate({
        target: messageFeedback.messageId,
        set: { rating, comment, updatedAt: new Date() },
      });
  }

  async delete(messageId: string): Promise<boolean> {
    const deleted = await this.database
      .delete(messageFeedback)
      .where(eq(messageFeedback.messageId, messageId))
      .returning({ messageId: messageFeedback.messageId });
    return deleted.length > 0;
  }

  async listForMessages(messageIds: readonly string[]): Promise<MessageFeedbackRecord[]> {
    if (messageIds.length === 0) return [];
    return this.database
      .select()
      .from(messageFeedback)
      .where(inArray(messageFeedback.messageId, [...messageIds]));
  }

  async listRecent(limit: number): Promise<RatedAnswer[]> {
    const loadedLength = FEEDBACK_EXCERPT_LENGTH + 1;
    return this.database
      .select({
        feedback: messageFeedback,
        conversationId: chatMessages.conversationId,
        turnId: chatMessages.turnId,
        questionStart: sql<string>`coalesce(
          (select left(string_agg(question.content, ' ' order by question.sequence_number), ${loadedLength})
             from ${chatMessages} as question
            where question.turn_id = ${chatMessages.turnId} and question.role = 'user'),
          '')`,
        answerStart: sql<string>`left(${chatMessages.content}, ${loadedLength})`,
      })
      .from(messageFeedback)
      .innerJoin(chatMessages, eq(chatMessages.id, messageFeedback.messageId))
      .orderBy(desc(messageFeedback.createdAt))
      .limit(limit);
  }
}
