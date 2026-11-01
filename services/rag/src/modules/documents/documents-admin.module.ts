import { Module } from '@nestjs/common';

import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { IndexVersionsModule } from '../index-versions/index-versions.module.js';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { DocumentContentService } from './document-content.service.js';
import { DocumentProgressStreamService } from './document-progress-stream.service.js';
import { DocumentUploadService } from './document-upload.service.js';
import { DocumentsAdminController } from './documents-admin.controller.js';
import { DocumentsAdminService } from './documents-admin.service.js';
import { DocumentsModule } from './documents.module.js';
import { IngestionRunsAdminController } from './ingestion-runs-admin.controller.js';

@Module({
  imports: [AdminAuthModule, DocumentsModule, IngestionModule, IndexVersionsModule],
  controllers: [DocumentsAdminController, IngestionRunsAdminController],
  providers: [
    DocumentUploadService,
    DocumentsAdminService,
    DocumentContentService,
    DocumentProgressStreamService,
  ],
  exports: [DocumentsAdminService],
})
export class DocumentsAdminModule {}
