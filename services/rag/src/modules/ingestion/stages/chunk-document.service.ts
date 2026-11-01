import { Injectable } from '@nestjs/common';

import { DocumentsRepository } from '../../documents/documents.repository.js';
import { LiveIndexService } from '../../index-versions/live-index.service.js';
import { DocumentIndexer } from '../document-indexer.service.js';
import { type IngestionRunReference, STAGE_PROGRESS } from '../ingestion-jobs.js';
import { IngestionPipelineService } from '../ingestion-pipeline.service.js';
import { IngestionRunsRepository } from '../ingestion-runs.repository.js';

/** Turns the run's blocks into retrieval chunks for the live index version. */
@Injectable()
export class ChunkDocumentService {
  constructor(
    private readonly documentIndexer: DocumentIndexer,
    private readonly liveIndex: LiveIndexService,
    private readonly ingestionRunsRepository: IngestionRunsRepository,
    private readonly documentsRepository: DocumentsRepository,
    private readonly ingestionPipeline: IngestionPipelineService,
  ) {}

  async chunk(runReference: IngestionRunReference, requestId: string | undefined): Promise<void> {
    if (!(await this.ingestionRunsRepository.isActive(runReference.ingestionRunId))) return;
    await this.ingestionRunsRepository.startStage(runReference.ingestionRunId, 'chunk', STAGE_PROGRESS.chunk);
    const document = await this.documentsRepository.findById(runReference.documentId);
    if (document === undefined) return;
    const liveVersion = await this.liveIndex.getOrCreateLiveVersion();
    await this.documentIndexer.chunkRun(document, runReference.ingestionRunId, liveVersion);
    await this.documentsRepository.update(runReference.documentId, { status: 'indexing' });
    await this.ingestionPipeline.enqueueNextStage('ingest.embed_index', runReference, requestId);
  }
}
