import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, isNull } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { widgetKeys } from '../../database/schema.js';

export type WidgetKeyRecord = typeof widgetKeys.$inferSelect;
export type NewWidgetKeyRecord = typeof widgetKeys.$inferInsert;
export type WidgetKeyChanges = Partial<Pick<WidgetKeyRecord, 'name' | 'allowedOrigins' | 'turnsPerMinute'>>;

@Injectable()
export class WidgetKeysRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Newest first; revoked keys stay listed for the record. */
  async list(): Promise<WidgetKeyRecord[]> {
    return this.database.select().from(widgetKeys).orderBy(desc(widgetKeys.createdAt));
  }

  async listActive(): Promise<WidgetKeyRecord[]> {
    return this.database.select().from(widgetKeys).where(isNull(widgetKeys.revokedAt));
  }

  async findById(widgetKeyId: string): Promise<WidgetKeyRecord | undefined> {
    const [record] = await this.database.select().from(widgetKeys).where(eq(widgetKeys.id, widgetKeyId));
    return record;
  }

  async insert(widgetKey: NewWidgetKeyRecord): Promise<WidgetKeyRecord> {
    const [inserted] = await this.database.insert(widgetKeys).values(widgetKey).returning();
    if (inserted === undefined) throw new Error('Inserting a widget key returned no row');
    return inserted;
  }

  async update(widgetKeyId: string, changes: WidgetKeyChanges): Promise<WidgetKeyRecord | undefined> {
    const [updated] = await this.database
      .update(widgetKeys)
      .set(changes)
      .where(eq(widgetKeys.id, widgetKeyId))
      .returning();
    return updated;
  }

  async revoke(widgetKeyId: string, revokedAt: Date): Promise<WidgetKeyRecord | undefined> {
    const [revoked] = await this.database
      .update(widgetKeys)
      .set({ revokedAt })
      .where(eq(widgetKeys.id, widgetKeyId))
      .returning();
    return revoked;
  }
}
