import type { Job } from 'bullmq';
import type { z } from 'zod';

import type { JobEnvelope } from './job-envelope.js';
import type { QueueName } from './queue-names.js';

export interface JobContext<Payload> {
  readonly job: Job<JobEnvelope<unknown>>;
  readonly payload: Payload;
  readonly requestId: string | undefined;
}

/**
 * One consumer per queue, run by the worker process. Handlers stay thin: they validate
 * the payload and delegate to a use-case service.
 */
export interface QueueJobHandler<Payload = unknown> {
  readonly queueName: QueueName;
  readonly payloadSchema: z.ZodType<Payload>;
  /** Parallel jobs per worker process; defaults to the configured worker concurrency. */
  readonly concurrency?: number;
  /** How long a job may run between lock renewals before it counts as stalled. */
  readonly lockDurationMilliseconds?: number;
  handle(context: JobContext<Payload>): Promise<unknown>;
  /** Called once when the job will not be retried again (permanent error or attempts used up). */
  onFinalFailure?(payload: Payload, error: Error): Promise<void>;
}

/** Multi-provider token collecting every handler for the worker host. */
export const QUEUE_JOB_HANDLERS = Symbol('QUEUE_JOB_HANDLERS');
