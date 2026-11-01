import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { indexVersions } from '../../database/schema.js';

export type IndexVersionRecord = typeof indexVersions.$inferSelect;
export type NewIndexVersionRecord = typeof indexVersions.$inferInsert;

@Injectable()
export class IndexVersionsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findLive(): Promise<IndexVersionRecord | undefined> {
    const [liveVersion] = await this.database
      .select()
      .from(indexVersions)
      .where(eq(indexVersions.status, 'live'));
    return liveVersion;
  }

  async findById(indexVersionId: number): Promise<IndexVersionRecord | undefined> {
    const [version] = await this.database
      .select()
      .from(indexVersions)
      .where(eq(indexVersions.id, indexVersionId));
    return version;
  }

  async list(): Promise<IndexVersionRecord[]> {
    return this.database.select().from(indexVersions).orderBy(desc(indexVersions.id));
  }

  async insert(version: NewIndexVersionRecord): Promise<IndexVersionRecord> {
    const [inserted] = await this.database.insert(indexVersions).values(version).returning();
    if (inserted === undefined) throw new Error('Inserting an index version returned no row');
    return inserted;
  }

  /** Makes `indexVersionId` the single live version and retires the previous one, atomically. */
  async promote(indexVersionId: number): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(indexVersions)
        .set({ status: 'retired' })
        .where(eq(indexVersions.status, 'live'));
      await transaction
        .update(indexVersions)
        .set({ status: 'live', promotedAt: new Date() })
        .where(eq(indexVersions.id, indexVersionId));
    });
  }

  async markReady(indexVersionId: number): Promise<void> {
    await this.database
      .update(indexVersions)
      .set({ status: 'ready' })
      .where(eq(indexVersions.id, indexVersionId));
  }

  async delete(indexVersionId: number): Promise<void> {
    await this.database.delete(indexVersions).where(eq(indexVersions.id, indexVersionId));
  }

  async markFailed(indexVersionId: number): Promise<void> {
    await this.database
      .update(indexVersions)
      .set({ status: 'failed' })
      .where(eq(indexVersions.id, indexVersionId));
  }
}
