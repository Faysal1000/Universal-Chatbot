import { Inject, Injectable } from '@nestjs/common';
import { inArray, lt } from 'drizzle-orm';

import { DATABASE, type Database } from '../../../database/database.tokens.js';
import { retrievalTraces } from '../../../database/schema.js';
import type { RetrievalTrace } from '../../retrieval/retrieval-trace.js';

@Injectable()
export class RetrievalTracesRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async upsert(turnId: string, trace: RetrievalTrace): Promise<void> {
    const traceDocument = { ...trace } as Record<string, unknown>;
    await this.database
      .insert(retrievalTraces)
      .values({ turnId, trace: traceDocument })
      .onConflictDoUpdate({ target: retrievalTraces.turnId, set: { trace: traceDocument } });
  }

  async findByTurns(turnIds: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
    if (turnIds.length === 0) return new Map();
    const rows = await this.database
      .select()
      .from(retrievalTraces)
      .where(inArray(retrievalTraces.turnId, [...turnIds]));
    return new Map(rows.map((row) => [row.turnId, row.trace]));
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const deleted = await this.database
      .delete(retrievalTraces)
      .where(lt(retrievalTraces.createdAt, cutoff))
      .returning({ turnId: retrievalTraces.turnId });
    return deleted.length;
  }
}
