import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { ProblemDetailsExceptionFilter } from '../common/errors/problem-details.filter.js';
import type { ServiceConfiguration } from '../config/configuration.js';
import {
  INGESTION_JOB_HANDLERS,
  IngestionWorkerModule,
} from '../modules/ingestion/ingestion-worker.module.js';
import { ConversationSummaryHandler } from '../modules/chat/summaries/conversation-summary.handler.js';
import { ConversationSummariesWorkerModule } from '../modules/chat/summaries/conversation-summaries-worker.module.js';
import { IndexBuildHandler } from '../modules/index-versions/build/index-build.handler.js';
import { IndexBuildWorkerModule } from '../modules/index-versions/build/index-build-worker.module.js';
import { MaintenanceHandler } from '../modules/maintenance/maintenance.handler.js';
import { MaintenanceWorkerModule } from '../modules/maintenance/maintenance-worker.module.js';
import { QUEUE_JOB_HANDLERS, type QueueJobHandler } from '../queue/queue-job-handler.js';
import { QueueWorkerHostService } from '../queue/queue-worker-host.service.js';
import { coreModules } from './core-modules.js';

const JOB_HANDLER_TYPES = [
  ...INGESTION_JOB_HANDLERS,
  ConversationSummaryHandler,
  MaintenanceHandler,
  IndexBuildHandler,
];

/**
 * Root module of the pipeline worker process. It serves only `/health/*` over HTTP;
 * its real work is consuming BullMQ queues.
 */
@Module({})
export class WorkerModule {
  static register(configuration: ServiceConfiguration): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ...coreModules(configuration),
        IngestionWorkerModule,
        ConversationSummariesWorkerModule,
        MaintenanceWorkerModule,
        IndexBuildWorkerModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
        {
          provide: QUEUE_JOB_HANDLERS,
          inject: JOB_HANDLER_TYPES,
          useFactory: (...handlers: QueueJobHandler[]) => handlers,
        },
        QueueWorkerHostService,
      ],
    };
  }
}
