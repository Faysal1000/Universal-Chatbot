import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { blocks, documentPages } from '../../database/schema.js';
import type { DocumentBlock } from '../../domain/chunking/document-blocks.js';

export type NewBlockRecord = typeof blocks.$inferInsert;
export type NewDocumentPageRecord = typeof documentPages.$inferInsert;
export type BlockRecord = typeof blocks.$inferSelect;
export type DocumentPageRecord = typeof documentPages.$inferSelect;

/** Rows per INSERT; keeps each statement well under Postgres' 65,535 parameter limit. */
const INSERT_BATCH_SIZE = 500;

/** Pages and blocks of a document. Each successful run replaces the previous run's rows. */
@Injectable()
export class ParsedContentRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async replaceRunContent(
    documentId: string,
    ingestionRunId: string,
    pages: readonly NewDocumentPageRecord[],
    blockRecords: readonly NewBlockRecord[],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.delete(blocks).where(eq(blocks.ingestionRunId, ingestionRunId));
      await transaction.delete(documentPages).where(eq(documentPages.documentId, documentId));
      for (let offset = 0; offset < pages.length; offset += INSERT_BATCH_SIZE) {
        await transaction.insert(documentPages).values(pages.slice(offset, offset + INSERT_BATCH_SIZE));
      }
      for (let offset = 0; offset < blockRecords.length; offset += INSERT_BATCH_SIZE) {
        await transaction.insert(blocks).values(blockRecords.slice(offset, offset + INSERT_BATCH_SIZE));
      }
    });
  }

  async loadRunBlocks(ingestionRunId: string): Promise<DocumentBlock[]> {
    const rows = await this.database
      .select()
      .from(blocks)
      .where(eq(blocks.ingestionRunId, ingestionRunId))
      .orderBy(asc(blocks.pageNumber), asc(blocks.readingOrder));
    return rows.map(toDocumentBlock);
  }

  async loadBlocksByIds(blockIds: readonly string[]): Promise<BlockRecord[]> {
    if (blockIds.length === 0) return [];
    return this.database
      .select()
      .from(blocks)
      .where(inArray(blocks.id, [...blockIds]));
  }

  /** Blocks of the page as produced by the run that stored the page. */
  async loadPageBlocks(
    page: Pick<DocumentPageRecord, 'ingestionRunId' | 'pageNumber'>,
  ): Promise<BlockRecord[]> {
    return this.database
      .select()
      .from(blocks)
      .where(and(eq(blocks.ingestionRunId, page.ingestionRunId), eq(blocks.pageNumber, page.pageNumber)))
      .orderBy(asc(blocks.readingOrder));
  }

  async findBlock(documentId: string, blockId: string): Promise<BlockRecord | undefined> {
    const [block] = await this.database
      .select()
      .from(blocks)
      .where(and(eq(blocks.documentId, documentId), eq(blocks.id, blockId)));
    return block;
  }

  async loadPages(documentId: string): Promise<DocumentPageRecord[]> {
    return this.database
      .select()
      .from(documentPages)
      .where(eq(documentPages.documentId, documentId))
      .orderBy(asc(documentPages.pageNumber));
  }

  async findPage(documentId: string, pageNumber: number): Promise<DocumentPageRecord | undefined> {
    const [page] = await this.database
      .select()
      .from(documentPages)
      .where(and(eq(documentPages.documentId, documentId), eq(documentPages.pageNumber, pageNumber)));
    return page;
  }

  /** Drops blocks of earlier runs once a newer run has been indexed. */
  async deleteBlocksOfOtherRuns(documentId: string, currentIngestionRunId: string): Promise<void> {
    await this.database
      .delete(blocks)
      .where(and(eq(blocks.documentId, documentId), ne(blocks.ingestionRunId, currentIngestionRunId)));
  }
}

function toDocumentBlock(row: BlockRecord): DocumentBlock {
  return {
    id: row.id,
    pageNumber: row.pageNumber,
    readingOrder: row.readingOrder,
    blockType: row.blockType,
    text: row.text,
    markdown: row.markdown,
    latex: row.latex,
    headingLevel: row.headingLevel,
    bbox: { x0: row.bboxX0, y0: row.bboxY0, x1: row.bboxX1, y1: row.bboxY1 },
    cropStorageKey: row.cropStorageKey,
    sectionPath: row.sectionPath,
  };
}
