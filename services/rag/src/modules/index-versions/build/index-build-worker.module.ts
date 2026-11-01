import { Module } from '@nestjs/common';

import { DocumentsModule } from '../../documents/documents.module.js';
import { IngestionWorkerModule } from '../../ingestion/ingestion-worker.module.js';
import { IndexVersionsModule } from '../index-versions.module.js';
import { IndexBuildHandler } from './index-build.handler.js';
import { IndexBuildService } from './index-build.service.js';

/** Worker-only: builds and catches up index versions. */
@Module({
  imports: [IndexVersionsModule, DocumentsModule, IngestionWorkerModule],
  providers: [IndexBuildService, IndexBuildHandler],
  exports: [IndexBuildHandler],
})
export class IndexBuildWorkerModule {}
