import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { type IngestionRunStatus, type IngestionStage, ingestionRuns } from '../../database/schema.js';

export type IngestionRunRecord = typeof ingestionRuns.$inferSelect;

export interface PageKindCounts {
  readonly digital: number;
  readonly scanned: number;
  readonly hybrid: number;
}

@Injectable()
export class IngestionRunsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async create(documentId: string, pipelineVersion: string): Promise<IngestionRunRecord> {
    const [run] = await this.database
      .insert(ingestionRuns)
      .values({ documentId, pipelineVersion, status: 'queued', stage: 'inspect' })
      .returning();
    if (run === undefined) throw new Error('Inserting an ingestion run returned no row');
    return run;
  }

  async findById(ingestionRunId: string): Promise<IngestionRunRecord | undefined> {
    const [run] = await this.database
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.id, ingestionRunId));
    return run;
  }

  /** False once a run was cancelled (re-upload, reprocess, deletion), failed or finished. */
  async isActive(ingestionRunId: string): Promise<boolean> {
    const run = await this.findById(ingestionRunId);
    return run !== undefined && (run.status === 'queued' || run.status === 'running');
  }

  async listForDocument(documentId: string, limit: number): Promise<IngestionRunRecord[]> {
    return this.database
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.documentId, documentId))
      .orderBy(desc(ingestionRuns.createdAt))
      .limit(limit);
  }

  /** Newest first; `documentId` narrows the list to one document's runs. */
  async listByStatuses(
    statuses: readonly IngestionRunStatus[],
    limit: number,
    documentId?: string,
  ): Promise<IngestionRunRecord[]> {
    return this.database
      .select()
      .from(ingestionRuns)
      .where(
        and(
          inArray(ingestionRuns.status, [...statuses]),
          documentId === undefined ? undefined : eq(ingestionRuns.documentId, documentId),
        ),
      )
      .orderBy(desc(ingestionRuns.createdAt))
      .limit(limit);
  }

  async startStage(ingestionRunId: string, stage: IngestionStage, progressPercent: number): Promise<void> {
    await this.database
      .update(ingestionRuns)
      .set({
        stage,
        status: 'running',
        progressPercent,
        startedAt: sql`coalesce(${ingestionRuns.startedAt}, now())`,
      })
      .where(and(eq(ingestionRuns.id, ingestionRunId), inArray(ingestionRuns.status, ['queued', 'running'])));
  }

  async recordInspection(
    ingestionRunId: string,
    pagesTotal: number,
    pageKinds: PageKindCounts,
  ): Promise<void> {
    await this.database
      .update(ingestionRuns)
      .set({
        pagesTotal,
        pagesDigital: pageKinds.digital,
        pagesScanned: pageKinds.scanned,
        pagesHybrid: pageKinds.hybrid,
      })
      .where(eq(ingestionRuns.id, ingestionRunId));
  }

  async recordParsingProgress(
    ingestionRunId: string,
    pagesParsed: number,
    progressPercent: number,
  ): Promise<void> {
    await this.database
      .update(ingestionRuns)
      .set({ pagesParsed, progressPercent })
      .where(and(eq(ingestionRuns.id, ingestionRunId), eq(ingestionRuns.status, 'running')));
  }

  async recordProgress(ingestionRunId: string, progressPercent: number): Promise<void> {
    await this.database
      .update(ingestionRuns)
      .set({ progressPercent })
      .where(and(eq(ingestionRuns.id, ingestionRunId), eq(ingestionRuns.status, 'running')));
  }

  async addVisionModelCalls(ingestionRunId: string, callCount: number): Promise<void> {
    await this.database
      .update(ingestionRuns)
      .set({ vlmCallCount: sql`${ingestionRuns.vlmCallCount} + ${callCount}` })
      .where(eq(ingestionRuns.id, ingestionRunId));
  }

  /** Returns false when the run was cancelled meanwhile, for example by a newer reprocess. */
  async markSucceeded(ingestionRunId: string): Promise<boolean> {
    const updated = await this.database
      .update(ingestionRuns)
      .set({ status: 'succeeded', stage: 'finalize', progressPercent: 100, finishedAt: new Date() })
      .where(and(eq(ingestionRuns.id, ingestionRunId), inArray(ingestionRuns.status, ['queued', 'running'])))
      .returning({ id: ingestionRuns.id });
    return updated.length > 0;
  }

  async markFailed(ingestionRunId: string, failureCode: string, failureMessage: string): Promise<void> {
    await this.database
      .update(ingestionRuns)
      .set({
        status: 'failed',
        failureCode,
        failureMessage: failureMessage.slice(0, 2_000),
        finishedAt: new Date(),
      })
      .where(and(eq(ingestionRuns.id, ingestionRunId), ne(ingestionRuns.status, 'succeeded')));
  }

  /** Cancels unfinished runs of a document before a new run or deletion starts. */
  async cancelUnfinishedRuns(documentId: string): Promise<void> {
    await this.database
      .update(ingestionRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(
        and(eq(ingestionRuns.documentId, documentId), inArray(ingestionRuns.status, ['queued', 'running'])),
      );
  }
}
