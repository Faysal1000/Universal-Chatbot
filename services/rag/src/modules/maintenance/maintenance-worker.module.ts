import { Module } from '@nestjs/common';

import { ChatPersistenceModule } from '../chat/persistence/chat-persistence.module.js';
import { VisitorSessionsRepository } from '../public-access/visitor-sessions.repository.js';
import { MaintenanceHandler } from './maintenance.handler.js';
import { MaintenanceSchedulerService } from './maintenance-scheduler.service.js';
import { RetentionSweepService } from './retention-sweep.service.js';

/** Worker-only: periodic data retention. */
@Module({
  imports: [ChatPersistenceModule],
  // The repository alone, not PublicAccessModule, which would bring public HTTP routes along.
  providers: [
    VisitorSessionsRepository,
    RetentionSweepService,
    MaintenanceHandler,
    MaintenanceSchedulerService,
  ],
  exports: [MaintenanceHandler],
})
export class MaintenanceWorkerModule {}
