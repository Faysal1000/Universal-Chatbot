import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Queue, UnrecoverableError, Worker } from 'bullmq';

import { toError } from '../common/errors/error-message.js';
import { UpstreamServiceError } from '../common/outbound-http/upstream-service-error.js';
import type { ServiceConfiguration } from '../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../config/configuration.module.js';
import type { DeadLetterRecord } from './dead-letter-record.js';
import { type JobEnvelope, parseJobEnvelope } from './job-envelope.js';
import { PermanentJobError } from './permanent-job-error.js';
import { QUEUE_JOB_HANDLERS, type QueueJobHandler } from './queue-job-handler.js';
import { QUEUE_NAMES } from './queue-names.js';

const DEFAULT_LOCK_DURATION_MILLISECONDS = 5 * 60_000;

/**
 * Runs one BullMQ worker per registered handler in the worker process. It owns the
 * cross-cutting job concerns: envelope and payload validation, mapping
 * permanent errors to UnrecoverableError, final-failure hooks and the dead-letter copy.
 */
@Injectable()
export class QueueWorkerHostService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueWorkerHostService.name);
  private readonly workers: Worker[] = [];
  private deadLetterQueue: Queue | undefined;

  constructor(
    @Inject(QUEUE_JOB_HANDLERS) private readonly handlers: readonly QueueJobHandler[],
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  onApplicationBootstrap(): void {
    this.deadLetterQueue = new Queue(QUEUE_NAMES.deadLetter, this.connectionOptions());
    for (const handler of this.handlers) this.workers.push(this.startWorker(handler));
    this.logger.log(`Consuming ${this.handlers.map((handler) => handler.queueName).join(', ')}`);
  }

  async onApplicationShutdown(): Promise<void> {
    // close() waits for active jobs, so in-flight work finishes or is retried after restart.
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.deadLetterQueue?.close();
  }

  private startWorker(handler: QueueJobHandler): Worker {
    const worker = new Worker<JobEnvelope<unknown>>(
      handler.queueName,
      (job) => this.processJob(handler, job),
      {
        ...this.connectionOptions(),
        concurrency: handler.concurrency ?? this.configuration.ingestion.workerConcurrency,
        lockDuration: handler.lockDurationMilliseconds ?? DEFAULT_LOCK_DURATION_MILLISECONDS,
      },
    );
    worker.on('failed', (job, error) => {
      if (job !== undefined) void this.handleFailure(handler, job, error);
    });
    worker.on('error', (error) => {
      this.logger.error({ err: error, queueName: handler.queueName }, 'Queue worker error');
    });
    return worker;
  }

  private async processJob(handler: QueueJobHandler, job: Job<JobEnvelope<unknown>>): Promise<unknown> {
    const envelope = parseOrFailPermanently(() => parseJobEnvelope(job.data));
    const payloadResult = handler.payloadSchema.safeParse(envelope.payload);
    if (!payloadResult.success) {
      throw new UnrecoverableError(`invalid_payload: ${payloadResult.error.message}`);
    }
    try {
      return await handler.handle({ job, payload: payloadResult.data, requestId: envelope.meta.requestId });
    } catch (error: unknown) {
      throw toBullMqError(error);
    }
  }

  private async handleFailure(
    handler: QueueJobHandler,
    job: Job<JobEnvelope<unknown>>,
    error: Error,
  ): Promise<void> {
    if (!isFinalFailure(job, error)) return;
    this.logger.error(
      { err: error, queueName: handler.queueName, jobId: job.id, attemptsMade: job.attemptsMade },
      'Job failed permanently',
    );
    await this.runFinalFailureHook(handler, job, error);
    try {
      await this.copyToDeadLetterQueue(handler.queueName, job, error);
    } catch (copyError: unknown) {
      this.logger.error({ err: copyError, jobId: job.id }, 'Could not copy the job to the dead-letter queue');
    }
  }

  /** A malformed job has no payload to hand over; it still goes to the dead-letter queue. */
  private async runFinalFailureHook(handler: QueueJobHandler, job: Job, error: Error): Promise<void> {
    if (handler.onFinalFailure === undefined) return;
    try {
      const payload = handler.payloadSchema.safeParse(parseJobEnvelope(job.data).payload);
      if (payload.success) await handler.onFinalFailure(payload.data, error);
    } catch (hookError: unknown) {
      this.logger.error({ err: hookError, jobId: job.id }, 'Final-failure handling failed');
    }
  }

  private async copyToDeadLetterQueue(queueName: string, job: Job, error: Error): Promise<void> {
    const { failureCode, failureMessage } = describeJobFailure(error.message);
    const record: DeadLetterRecord = {
      originalQueueName: queueName,
      originalJobId: job.id,
      originalJobName: job.name,
      payload: job.data as unknown,
      failureCode,
      failureMessage,
      failedAt: new Date().toISOString(),
      attemptsMade: job.attemptsMade,
    };
    await this.deadLetterQueue?.add('dead-letter', record, {
      jobId: `${queueName}.${job.id ?? 'unknown'}`,
      // No worker consumes this queue: records wait until an admin retries or discards them.
      removeOnComplete: true,
    });
  }

  private connectionOptions() {
    return {
      connection: { url: this.configuration.redis.url.reveal(), maxRetriesPerRequest: null },
      prefix: this.configuration.redis.keyPrefix,
    };
  }
}

function parseOrFailPermanently<Result>(parse: () => Result): Result {
  try {
    return parse();
  } catch (error: unknown) {
    throw new UnrecoverableError(`invalid_envelope: ${(error as Error).message}`);
  }
}

/** Permanent failures skip the remaining attempts; failure codes travel in the message. */
function toBullMqError(error: unknown): Error {
  if (error instanceof PermanentJobError) {
    return new UnrecoverableError(`${error.failureCode}: ${error.message}`);
  }
  if (error instanceof UpstreamServiceError && !error.isRetryable) {
    return new UnrecoverableError(`upstream_rejected: ${error.message}`);
  }
  return toError(error);
}

function isFinalFailure(job: Job, error: Error): boolean {
  return (
    error instanceof UnrecoverableError ||
    error.name === 'UnrecoverableError' ||
    job.attemptsMade >= (job.opts.attempts ?? 1)
  );
}

/** Failure messages are `<code>: <message>` when a code is known. */
export function describeJobFailure(message: string): { failureCode: string; failureMessage: string } {
  const match = /^([a-z][a-z0-9_]{2,63}): (.*)$/s.exec(message);
  return match?.[1] !== undefined && match[2] !== undefined
    ? { failureCode: match[1], failureMessage: match[2] }
    : { failureCode: 'job_failed', failureMessage: message };
}
