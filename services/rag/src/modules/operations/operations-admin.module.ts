import { Module } from '@nestjs/common';

import { QueueAdministrationService } from '../../queue/queue-administration.service.js';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { DocumentsAdminModule } from '../documents/documents-admin.module.js';
import { DeadLettersService } from './dead-letters.service.js';
import { OperationsAdminController } from './operations-admin.controller.js';

@Module({
  imports: [AdminAuthModule, DocumentsAdminModule],
  controllers: [OperationsAdminController],
  providers: [QueueAdministrationService, DeadLettersService],
})
export class OperationsAdminModule {}
