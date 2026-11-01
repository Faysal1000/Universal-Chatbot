import { Module } from '@nestjs/common';

import { ParserContracts } from '../../contracts/parser-contracts.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { IndexVersionsModule } from '../index-versions/index-versions.module.js';
import { DocumentIndexer } from './document-indexer.service.js';
import { DocumentDeleteHandler } from './handlers/document-delete.handler.js';
import { IngestAssembleHandler } from './handlers/ingest-assemble.handler.js';
import { IngestChunkHandler } from './handlers/ingest-chunk.handler.js';
import { IngestEmbedIndexHandler } from './handlers/ingest-embed-index.handler.js';
import { IngestFinalizeHandler } from './handlers/ingest-finalize.handler.js';
import { IngestPlanHandler } from './handlers/ingest-plan.handler.js';
import { IngestionModule } from './ingestion.module.js';
import { ParseProgressListener } from './parse-progress-listener.service.js';
import { AssembleDocumentService } from './stages/assemble-document.service.js';
import { ChunkDocumentService } from './stages/chunk-document.service.js';
import { DeleteDocumentService } from './stages/delete-document.service.js';
import { FinalizeIngestionService } from './stages/finalize-ingestion.service.js';
import { IndexDocumentChunksService } from './stages/index-document-chunks.service.js';
import { PlanParsingService } from './stages/plan-parsing.service.js';

export const INGESTION_JOB_HANDLERS = [
  IngestPlanHandler,
  IngestAssembleHandler,
  IngestChunkHandler,
  IngestEmbedIndexHandler,
  IngestFinalizeHandler,
  DocumentDeleteHandler,
] as const;

/** The ingestion stages and their queue consumers; loaded only by the worker process. */
@Module({
  imports: [IngestionModule, DocumentsModule, IndexVersionsModule],
  providers: [
    ParserContracts,
    DocumentIndexer,
    PlanParsingService,
    AssembleDocumentService,
    ChunkDocumentService,
    IndexDocumentChunksService,
    FinalizeIngestionService,
    DeleteDocumentService,
    ParseProgressListener,
    ...INGESTION_JOB_HANDLERS,
  ],
  exports: [...INGESTION_JOB_HANDLERS, DocumentIndexer],
})
export class IngestionWorkerModule {}
