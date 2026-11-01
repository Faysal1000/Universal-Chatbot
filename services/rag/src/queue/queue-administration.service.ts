import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';

import type { ServiceConfiguration } from '../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../config/configuration.module.js';
import type { DeadLetterRecord } from './dead-letter-record.js';
import { QUEUE_NAMES, type QueueName } from './queue-names.js';

const COUNTED_JOB_STATES = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;
type CountedJobState = (typeof COUNTED_JOB_STATES)[number];

export interface QueueJobCounts {
  readonly queueName: QueueName;
  readonly counts: Readonly<Record<CountedJobState, number>>;
  readonly isPaused: boolean;
  /** Parse queues are consumed by document-parser; the rest by the rag worker. */
  readonly consumer: 'rag-worker' | 'document-parser' | 'none';
}

export interface StoredDeadLetter {
  readonly id: string;
  readonly record: DeadLetterRecord;
}

export interface DeadLetterPage {
  readonly items: readonly StoredDeadLetter[];
  readonly total: number;
}

/** Records wait in these states because nothing consumes the dead-letter queue. */
const PARKED_STATES = ['waiting', 'delayed'] as const;

/** Read and repair access to the BullMQ queues, for the admin API. */
@Injectable()
export class QueueAdministrationService implements OnApplicationShutdown {
  private readonly queuesByName = new Map<QueueName, Queue>();

  constructor(@Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration) {}

  async countJobs(): Promise<QueueJobCounts[]> {
    return Promise.all(
      Object.values(QUEUE_NAMES).map(async (queueName) => {
        const queue = this.queue(queueName);
        const [counts, isPaused] = await Promise.all([
          queue.getJobCounts(...COUNTED_JOB_STATES),
          queue.isPaused(),
        ]);
        return {
          queueName,
          counts: Object.fromEntries(
            COUNTED_JOB_STATES.map((state) => [state, counts[state] ?? 0]),
          ) as Record<CountedJobState, number>,
          isPaused,
          consumer: consumerOf(queueName),
        };
      }),
    );
  }

  async listDeadLetters(offset: number, limit: number): Promise<DeadLetterPage> {
    const deadLetterQueue = this.queue(QUEUE_NAMES.deadLetter);
    const [jobs, total] = await Promise.all([
      deadLetterQueue.getJobs([...PARKED_STATES], offset, offset + limit - 1, false),
      deadLetterQueue.getJobCountByTypes(...PARKED_STATES),
    ]);
    return {
      items: jobs.flatMap((job) =>
        job.id === undefined ? [] : [{ id: job.id, record: job.data as DeadLetterRecord }],
      ),
      total,
    };
  }

  async findDeadLetter(deadLetterId: string): Promise<StoredDeadLetter | undefined> {
    const job = await this.queue(QUEUE_NAMES.deadLetter).getJob(deadLetterId);
    if (job?.id === undefined) return undefined;
    return { id: job.id, record: job.data as DeadLetterRecord };
  }

  /** Returns false when the record no longer exists. */
  async discardDeadLetter(deadLetterId: string): Promise<boolean> {
    return (await this.queue(QUEUE_NAMES.deadLetter).remove(deadLetterId)) === 1;
  }

  /**
   * Moves a failed job back to waiting with fresh attempts. Returns false when the job
   * has been removed meanwhile (failed jobs are kept for 14 days) or is no longer failed.
   */
  async retryFailedJob(queueName: QueueName, jobId: string): Promise<boolean> {
    const job = await this.queue(queueName).getJob(jobId);
    if (job === undefined || !(await job.isFailed())) return false;
    await job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
    return true;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queuesByName.values()].map((queue) => queue.close()));
  }

  private queue(queueName: QueueName): Queue {
    let queue = this.queuesByName.get(queueName);
    if (queue === undefined) {
      queue = new Queue(queueName, {
        connection: { url: this.configuration.redis.url.reveal(), maxRetriesPerRequest: null },
        prefix: this.configuration.redis.keyPrefix,
      });
      this.queuesByName.set(queueName, queue);
    }
    return queue;
  }
}

function consumerOf(queueName: QueueName): QueueJobCounts['consumer'] {
  if (queueName === QUEUE_NAMES.parseInspect || queueName === QUEUE_NAMES.parsePages) {
    return 'document-parser';
  }
  if (queueName === QUEUE_NAMES.deadLetter) return 'none';
  return 'rag-worker';
}
