import { Injectable } from '@nestjs/common';

import { DocumentsRepository } from '../../documents/documents.repository.js';
import { ChunksRepository } from '../../index-versions/chunks.repository.js';
import { LiveIndexService } from '../../index-versions/live-index.service.js';
import { DocumentIndexer } from '../document-indexer.service.js';
import { type IngestionRunReference, STAGE_PROGRESS } from '../ingestion-jobs.js';
import { IngestionPipelineService } from '../ingestion-pipeline.service.js';
import { IngestionRunsRepository } from '../ingestion-runs.repository.js';

/** Embeds a run's chunks and stores their vectors and search terms in the live index version. */
@Injectable()
export class IndexDocumentChunksService {
  constructor(
    private readonly documentIndexer: DocumentIndexer,
    private readonly chunksRepository: ChunksRepository,
    private readonly liveIndex: LiveIndexService,
    private readonly ingestionRunsRepository: IngestionRunsRepository,
    private readonly documentsRepository: DocumentsRepository,
    private readonly ingestionPipeline: IngestionPipelineService,
  ) {}

  async index(runReference: IngestionRunReference, requestId: string | undefined): Promise<void> {
    const { ingestionRunId } = runReference;
    if (!(await this.ingestionRunsRepository.isActive(ingestionRunId))) return;
    await this.ingestionRunsRepository.startStage(ingestionRunId, 'embed_index', STAGE_PROGRESS.indexStart);
    const document = await this.documentsRepository.findById(runReference.documentId);
    if (document === undefined) return;
    const liveVersion = await this.liveIndex.getOrCreateLiveVersion();
    const storedChunks = await this.chunksRepository.loadRunChunks(ingestionRunId, liveVersion.id);
    // A version promoted after the chunk stage has none of this run's chunks yet.
    const runChunks =
      storedChunks.length > 0
        ? storedChunks
        : await this.documentIndexer.chunkRun(document, ingestionRunId, liveVersion);
    await this.documentIndexer.embedChunks(document, runChunks, liveVersion, async (indexedChunks) => {
      await this.ingestionRunsRepository.recordProgress(
        ingestionRunId,
        indexingProgressPercent(indexedChunks, runChunks.length),
      );
      return this.ingestionRunsRepository.isActive(ingestionRunId);
    });
    if (!(await this.ingestionRunsRepository.isActive(ingestionRunId))) return;
    await this.ingestionPipeline.enqueueNextStage('ingest.finalize', runReference, requestId);
  }
}

function indexingProgressPercent(indexedChunks: number, totalChunks: number): number {
  const indexedShare = totalChunks === 0 ? 1 : indexedChunks / totalChunks;
  return Math.round(
    STAGE_PROGRESS.indexStart + indexedShare * (STAGE_PROGRESS.indexEnd - STAGE_PROGRESS.indexStart),
  );
}
