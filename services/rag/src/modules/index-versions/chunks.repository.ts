import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, exists, getTableColumns, inArray, ne, not, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { type BlockType, blocks, chunks, documents, ingestionRuns } from '../../database/schema.js';

export type ChunkRecord = typeof chunks.$inferSelect;
export type NewChunkRecord = typeof chunks.$inferInsert;

/** A chunk with the document fields retrieval and citations need. */
export interface HydratedChunk extends ChunkRecord {
  readonly documentTitle: string;
  readonly isDocumentEnabled: boolean;
}

/** A chunk with the distinct types of its blocks (heading, table, figure…), for the admin chunk list. */
export interface ChunkWithBlockTypes extends ChunkRecord {
  readonly blockTypes: BlockType[];
}

const INSERT_BATCH_SIZE = 500;

/** A ready document whose current run has no chunks in some index version yet. */
export interface MissingDocument {
  readonly documentId: string;
  readonly ingestionRunId: string;
}

@Injectable()
export class ChunksRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Replaces the chunks a run produced in one index version (idempotent on retry). */
  async replaceRunChunks(
    ingestionRunId: string,
    indexVersionId: number,
    chunkRecords: readonly NewChunkRecord[],
  ): Promise<ChunkRecord[]> {
    return this.database.transaction(async (transaction) => {
      await transaction
        .delete(chunks)
        .where(and(eq(chunks.ingestionRunId, ingestionRunId), eq(chunks.indexVersionId, indexVersionId)));
      const inserted: ChunkRecord[] = [];
      for (let offset = 0; offset < chunkRecords.length; offset += INSERT_BATCH_SIZE) {
        inserted.push(
          ...(await transaction
            .insert(chunks)
            .values(chunkRecords.slice(offset, offset + INSERT_BATCH_SIZE))
            .returning()),
        );
      }
      return inserted;
    });
  }

  async loadRunChunks(ingestionRunId: string, indexVersionId: number): Promise<ChunkRecord[]> {
    return this.database
      .select()
      .from(chunks)
      .where(and(eq(chunks.ingestionRunId, ingestionRunId), eq(chunks.indexVersionId, indexVersionId)))
      .orderBy(asc(chunks.pageStart), asc(chunks.createdAt));
  }

  /** A page of the document's chunks, each with the distinct types of the blocks it was built from. */
  async loadDocumentChunks(
    documentId: string,
    indexVersionId: number,
    limit: number,
    offset: number,
  ): Promise<ChunkWithBlockTypes[]> {
    return this.database
      .select({
        ...getTableColumns(chunks),
        blockTypes: sql<BlockType[]>`coalesce(
          (select array_agg(distinct ${blocks.blockType} order by ${blocks.blockType})
             from ${blocks} where ${blocks.id} = any(${chunks.blockIds})),
          '{}')`,
      })
      .from(chunks)
      .where(and(eq(chunks.documentId, documentId), eq(chunks.indexVersionId, indexVersionId)))
      .orderBy(asc(chunks.pageStart), asc(chunks.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async countDocumentChunks(documentId: string, indexVersionId: number): Promise<number> {
    const [result] = await this.database
      .select({ total: count() })
      .from(chunks)
      .where(and(eq(chunks.documentId, documentId), eq(chunks.indexVersionId, indexVersionId)));
    return result?.total ?? 0;
  }

  /** Loads chunks with their document; Postgres re-checks enablement, it is the source of truth. */
  async hydrate(chunkIds: readonly string[]): Promise<HydratedChunk[]> {
    if (chunkIds.length === 0) return [];
    const rows = await this.database
      .select({
        chunk: chunks,
        documentTitle: documents.title,
        originalFilename: documents.originalFilename,
        isDocumentEnabled: documents.isEnabled,
      })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(inArray(chunks.id, [...chunkIds]));
    return rows.map((row) => ({
      ...row.chunk,
      documentTitle: row.documentTitle ?? row.originalFilename,
      isDocumentEnabled: row.isDocumentEnabled,
    }));
  }

  async deleteChunksOfOtherRuns(documentId: string, currentIngestionRunId: string): Promise<void> {
    await this.database
      .delete(chunks)
      .where(and(eq(chunks.documentId, documentId), ne(chunks.ingestionRunId, currentIngestionRunId)));
  }

  /**
   * Ready documents whose current (latest succeeded) run is not chunked into the version.
   * Finalize deletes chunks of older runs everywhere, so a reprocessed document shows
   * up here for every version but the live one.
   */
  async findDocumentsMissingFromVersion(indexVersionId: number, limit: number): Promise<MissingDocument[]> {
    const rows = await this.currentRunsMissingFrom(indexVersionId).limit(limit);
    return rows.map((row) => ({ documentId: row.documentId, ingestionRunId: row.ingestionRunId }));
  }

  async countDocumentsMissingFromVersion(indexVersionId: number): Promise<number> {
    const missingRuns = this.currentRunsMissingFrom(indexVersionId).as('missing_runs');
    const [result] = await this.database.select({ total: count() }).from(missingRuns);
    return result?.total ?? 0;
  }

  private currentRunsMissingFrom(indexVersionId: number) {
    const currentRuns = this.database
      .selectDistinctOn([ingestionRuns.documentId], {
        documentId: ingestionRuns.documentId,
        ingestionRunId: ingestionRuns.id,
      })
      .from(ingestionRuns)
      .innerJoin(documents, eq(documents.id, ingestionRuns.documentId))
      .where(and(eq(documents.status, 'ready'), eq(ingestionRuns.status, 'succeeded')))
      .orderBy(ingestionRuns.documentId, desc(ingestionRuns.finishedAt))
      .as('current_runs');
    return this.database
      .select({ documentId: currentRuns.documentId, ingestionRunId: currentRuns.ingestionRunId })
      .from(currentRuns)
      .where(
        not(
          exists(
            this.database
              .select({ id: chunks.id })
              .from(chunks)
              .where(
                and(
                  eq(chunks.ingestionRunId, currentRuns.ingestionRunId),
                  eq(chunks.indexVersionId, indexVersionId),
                ),
              ),
          ),
        ),
      )
      .orderBy(currentRuns.documentId)
      .$dynamic();
  }
}
