import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { QueueProducerService } from '../../queue/queue-producer.service.js';
import { QUEUE_NAMES } from '../../queue/queue-names.js';
import { RETENTION_SWEEP_JOB_NAME } from './maintenance.handler.js';

/** Registers the retention sweep schedule when a worker starts (idempotent across replicas). */
@Injectable()
export class MaintenanceSchedulerService implements OnApplicationBootstrap {
  constructor(
    private readonly queueProducer: QueueProducerService,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queueProducer.scheduleRepeating(
      QUEUE_NAMES.maintenance,
      RETENTION_SWEEP_JOB_NAME,
      RETENTION_SWEEP_JOB_NAME,
      this.configuration.retention.maintenanceIntervalMinutes * 60_000,
    );
  }
}
