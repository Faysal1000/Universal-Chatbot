import { Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module.js';
import { IngestionFailureService } from './ingestion-failure.service.js';
import { IngestionPipelineService } from './ingestion-pipeline.service.js';
import { IngestionRunsRepository } from './ingestion-runs.repository.js';
import { ParsedContentRepository } from './parsed-content.repository.js';

/** What both processes need: starting runs (api) and moving them along (worker). */
@Module({
  imports: [DocumentsModule],
  providers: [
    IngestionPipelineService,
    IngestionRunsRepository,
    ParsedContentRepository,
    IngestionFailureService,
  ],
  exports: [
    IngestionPipelineService,
    IngestionRunsRepository,
    ParsedContentRepository,
    IngestionFailureService,
  ],
})
export class IngestionModule {}
