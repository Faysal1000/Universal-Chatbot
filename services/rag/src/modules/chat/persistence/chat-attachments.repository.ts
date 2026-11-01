import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';

import { DATABASE, type Database } from '../../../database/database.tokens.js';
import { chatAttachments, visitorSessions } from '../../../database/schema.js';

export type ChatAttachmentRecord = typeof chatAttachments.$inferSelect;
export type NewChatAttachmentRecord = typeof chatAttachments.$inferInsert;

@Injectable()
export class ChatAttachmentsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async insert(attachment: NewChatAttachmentRecord): Promise<ChatAttachmentRecord> {
    const [inserted] = await this.database.insert(chatAttachments).values(attachment).returning();
    if (inserted === undefined) throw new Error('Inserting an attachment returned no row');
    return inserted;
  }

  async findByIds(attachmentIds: readonly string[]): Promise<ChatAttachmentRecord[]> {
    if (attachmentIds.length === 0) return [];
    return this.database
      .select()
      .from(chatAttachments)
      .where(inArray(chatAttachments.id, [...attachmentIds]));
  }

  async listForMessages(messageIds: readonly string[]): Promise<ChatAttachmentRecord[]> {
    if (messageIds.length === 0) return [];
    return this.database
      .select()
      .from(chatAttachments)
      .where(inArray(chatAttachments.messageId, [...messageIds]))
      .orderBy(chatAttachments.createdAt);
  }

  /** Object keys of every image uploaded in sessions that expired before `cutoff`. */
  async listStorageKeysOfSessionsExpiredBefore(cutoff: Date): Promise<string[]> {
    const rows = await this.database
      .select({ storageKey: chatAttachments.storageKey })
      .from(chatAttachments)
      .innerJoin(visitorSessions, eq(visitorSessions.id, chatAttachments.visitorSessionId))
      .where(lt(visitorSessions.expiresAt, cutoff));
    return rows.map((row) => row.storageKey);
  }

  /** Unbound uploads past their expiry. */
  async listExpired(now: Date): Promise<ChatAttachmentRecord[]> {
    return this.database
      .select()
      .from(chatAttachments)
      .where(and(isNotNull(chatAttachments.expiresAt), lt(chatAttachments.expiresAt, now)));
  }

  async deleteByIds(attachmentIds: readonly string[]): Promise<void> {
    if (attachmentIds.length === 0) return;
    await this.database.delete(chatAttachments).where(inArray(chatAttachments.id, [...attachmentIds]));
  }
}
