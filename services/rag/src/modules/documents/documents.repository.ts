import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';

import { keysetBefore, keysetOrder, type KeysetPosition } from '../../common/pagination/keyset-cursor.js';
import { DATABASE, type Database } from '../../database/database.tokens.js';
import { escapeLikePattern } from '../../database/like-pattern.js';
import { type DocumentStatus, documents } from '../../database/schema.js';

export type DocumentRecord = typeof documents.$inferSelect;
export type NewDocumentRecord = typeof documents.$inferInsert;

export interface DocumentListFilter {
  readonly ids?: readonly string[];
  readonly status?: DocumentStatus;
  readonly isEnabled?: boolean;
  readonly mimeType?: string;
  readonly search?: string;
  /** Documents created strictly before this position. */
  readonly before?: KeysetPosition;
  readonly limit: number;
}

@Injectable()
export class DocumentsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async insert(document: NewDocumentRecord): Promise<DocumentRecord> {
    const [inserted] = await this.database.insert(documents).values(document).returning();
    if (inserted === undefined) throw new Error('Inserting a document returned no row');
    return inserted;
  }

  async findById(documentId: string): Promise<DocumentRecord | undefined> {
    const [document] = await this.database.select().from(documents).where(eq(documents.id, documentId));
    return document;
  }

  async findBySha256(sha256: string): Promise<DocumentRecord | undefined> {
    const [document] = await this.database.select().from(documents).where(eq(documents.sha256, sha256));
    return document;
  }

  async list(filter: DocumentListFilter): Promise<DocumentRecord[]> {
    return this.database
      .select()
      .from(documents)
      .where(and(...buildListConditions(filter)))
      .orderBy(...keysetOrder(documents.createdAt, documents.id))
      .limit(filter.limit);
  }

  async update(documentId: string, changes: Partial<NewDocumentRecord>): Promise<DocumentRecord | undefined> {
    const [updated] = await this.database
      .update(documents)
      .set(changes)
      .where(eq(documents.id, documentId))
      .returning();
    return updated;
  }

  async delete(documentId: string): Promise<void> {
    await this.database.delete(documents).where(eq(documents.id, documentId));
  }
}

function buildListConditions(filter: DocumentListFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.ids !== undefined) conditions.push(inArray(documents.id, [...filter.ids]));
  if (filter.status !== undefined) conditions.push(eq(documents.status, filter.status));
  if (filter.isEnabled !== undefined) conditions.push(eq(documents.isEnabled, filter.isEnabled));
  if (filter.mimeType !== undefined) conditions.push(eq(documents.mimeType, filter.mimeType));
  if (filter.search !== undefined) {
    const pattern = `%${escapeLikePattern(filter.search)}%`;
    const searchCondition = or(ilike(documents.title, pattern), ilike(documents.originalFilename, pattern));
    if (searchCondition !== undefined) conditions.push(searchCondition);
  }
  if (filter.before !== undefined)
    conditions.push(keysetBefore(documents.createdAt, documents.id, filter.before));
  return conditions;
}
