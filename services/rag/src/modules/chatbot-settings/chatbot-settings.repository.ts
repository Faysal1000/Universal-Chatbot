import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { chatbotSettingsVersions } from '../../database/schema.js';

export type ChatbotSettingsRecord = typeof chatbotSettingsVersions.$inferSelect;
export type NewChatbotSettingsRecord = Omit<
  typeof chatbotSettingsVersions.$inferInsert,
  'version' | 'isActive' | 'createdAt'
>;

/** Serialises changes of the active version, which a unique index allows only one of. */
const ACTIVE_VERSION_LOCK_KEY = 4_217_001;

@Injectable()
export class ChatbotSettingsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findActive(): Promise<ChatbotSettingsRecord | undefined> {
    const [settings] = await this.database
      .select()
      .from(chatbotSettingsVersions)
      .where(eq(chatbotSettingsVersions.isActive, true));
    return settings;
  }

  async findByVersion(version: number): Promise<ChatbotSettingsRecord | undefined> {
    const [settings] = await this.database
      .select()
      .from(chatbotSettingsVersions)
      .where(eq(chatbotSettingsVersions.version, version));
    return settings;
  }

  async listVersions(limit: number): Promise<ChatbotSettingsRecord[]> {
    return this.database
      .select()
      .from(chatbotSettingsVersions)
      .orderBy(desc(chatbotSettingsVersions.version))
      .limit(limit);
  }

  /** Appends a version and makes it the active one, atomically. */
  async insertActiveVersion(settings: NewChatbotSettingsRecord): Promise<ChatbotSettingsRecord> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(${ACTIVE_VERSION_LOCK_KEY})`);
      await transaction
        .update(chatbotSettingsVersions)
        .set({ isActive: false })
        .where(eq(chatbotSettingsVersions.isActive, true));
      const [inserted] = await transaction
        .insert(chatbotSettingsVersions)
        .values({ ...settings, isActive: true })
        .returning();
      if (inserted === undefined) throw new Error('Inserting chatbot settings returned no row');
      return inserted;
    });
  }

  async activate(version: number): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(${ACTIVE_VERSION_LOCK_KEY})`);
      await transaction
        .update(chatbotSettingsVersions)
        .set({ isActive: false })
        .where(eq(chatbotSettingsVersions.isActive, true));
      await transaction
        .update(chatbotSettingsVersions)
        .set({ isActive: true })
        .where(eq(chatbotSettingsVersions.version, version));
    });
  }
}
