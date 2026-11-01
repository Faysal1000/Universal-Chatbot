import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { QueueJobHandler } from '../../queue/queue-job-handler.js';
import { QUEUE_NAMES } from '../../queue/queue-names.js';
import { RetentionSweepService, type RetentionSweepResult } from './retention-sweep.service.js';

export const RETENTION_SWEEP_JOB_NAME = 'retention-sweep';

/** Scheduled jobs carry no payload; the time of the run is all they need. */
const maintenancePayloadSchema = z.object({});

@Injectable()
export class MaintenanceHandler implements QueueJobHandler<z.infer<typeof maintenancePayloadSchema>> {
  readonly queueName = QUEUE_NAMES.maintenance;
  readonly payloadSchema = maintenancePayloadSchema;
  readonly concurrency = 1;

  constructor(private readonly retentionSweep: RetentionSweepService) {}

  handle(): Promise<RetentionSweepResult> {
    return this.retentionSweep.sweep(new Date());
  }
}
