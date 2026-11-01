import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { chunks, chunkVectors, documents } from '../../database/schema.js';

type NewChunkVector = typeof chunkVectors.$inferInsert;

export interface SearchHit {
  readonly chunkId: string;
  readonly documentId: string;
  /** Cosine similarity for embedding hits, full-text rank for term hits. */
  readonly score: number;
}

interface Ranking {
  readonly score: SQL;
  readonly ordering: SQL;
  readonly match?: SQL;
}

/** Divides the full-text rank by 1 + log(chunk length), so long chunks do not win on length alone. */
const RANK_LENGTH_NORMALISATION = 1;

/** Searches one index version, over enabled documents only. */
@Injectable()
export class ChunkVectorsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async upsert(chunkVectorRecords: readonly NewChunkVector[]): Promise<void> {
    if (chunkVectorRecords.length === 0) return;
    await this.database
      .insert(chunkVectors)
      .values([...chunkVectorRecords])
      .onConflictDoUpdate({
        target: chunkVectors.chunkId,
        set: {
          embedding: sql`excluded.embedding`,
          searchTerms: sql`excluded.search_terms`,
        },
      });
  }

  /** An exact scan: a small organisation's corpus needs no approximate index. */
  async searchByEmbedding(
    indexVersionId: number,
    embedding: readonly number[],
    limit: number,
  ): Promise<SearchHit[]> {
    const distance = sql`${chunkVectors.embedding} <=> ${`[${embedding.join(',')}]`}::vector`;
    return this.search(indexVersionId, limit, { score: sql`1 - (${distance})`, ordering: distance });
  }

  async searchByTerms(indexVersionId: number, searchQuery: string, limit: number): Promise<SearchHit[]> {
    const query = sql`${searchQuery}::tsquery`;
    const rank = sql`ts_rank(${chunkVectors.searchTerms}, ${query}, ${RANK_LENGTH_NORMALISATION})`;
    return this.search(indexVersionId, limit, {
      score: rank,
      ordering: desc(rank),
      match: sql`${chunkVectors.searchTerms} @@ ${query}`,
    });
  }

  private async search(indexVersionId: number, limit: number, ranking: Ranking): Promise<SearchHit[]> {
    const { score, ordering, match } = ranking;
    return this.database
      .select({ chunkId: chunks.id, documentId: chunks.documentId, score: score.mapWith(Number) })
      .from(chunkVectors)
      .innerJoin(chunks, eq(chunks.id, chunkVectors.chunkId))
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(and(eq(chunkVectors.indexVersionId, indexVersionId), eq(documents.isEnabled, true), match))
      .orderBy(ordering)
      .limit(limit);
  }
}
