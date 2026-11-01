import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { clientBlocks } from '../../database/schema.js';

export type ClientBlockRecord = typeof clientBlocks.$inferSelect;
export type NewClientBlockRecord = typeof clientBlocks.$inferInsert;

@Injectable()
export class ClientBlocksRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async isBlocked(ipHash: string, fingerprintHash: string | null, now: Date): Promise<boolean> {
    const targetCondition =
      fingerprintHash === null
        ? eq(clientBlocks.ipHash, ipHash)
        : or(eq(clientBlocks.ipHash, ipHash), eq(clientBlocks.fingerprintHash, fingerprintHash));
    const [block] = await this.database
      .select({ id: clientBlocks.id })
      .from(clientBlocks)
      .where(and(targetCondition, or(isNull(clientBlocks.expiresAt), gt(clientBlocks.expiresAt, now))))
      .limit(1);
    return block !== undefined;
  }

  async list(limit: number): Promise<ClientBlockRecord[]> {
    return this.database.select().from(clientBlocks).orderBy(desc(clientBlocks.createdAt)).limit(limit);
  }

  async insert(block: NewClientBlockRecord): Promise<ClientBlockRecord> {
    const [inserted] = await this.database.insert(clientBlocks).values(block).returning();
    if (inserted === undefined) throw new Error('Inserting a client block returned no row');
    return inserted;
  }

  async delete(blockId: string): Promise<boolean> {
    const deleted = await this.database
      .delete(clientBlocks)
      .where(eq(clientBlocks.id, blockId))
      .returning({ id: clientBlocks.id });
    return deleted.length > 0;
  }
}
