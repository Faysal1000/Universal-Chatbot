import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { type FlowJob, FlowProducer, type JobsOptions, Queue } from 'bullmq';

import type { ServiceConfiguration } from '../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../config/configuration.module.js';
import { createJobEnvelope, type JobEnvelope } from './job-envelope.js';
import type { QueueName } from './queue-names.js';

/** Retry policy for transient failures; permanent ones throw UnrecoverableError instead. */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000, jitter: 0.5 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  // Failed jobs are kept for inspection and manual retry from the admin dashboard.
  removeOnFail: { age: 14 * 24 * 60 * 60 },
};

export interface EnqueueOptions {
  /**
   * Deterministic ID such as `{documentId}.{runId}.{stage}` (BullMQ forbids `:`). BullMQ
   * ignores an add whose ID already exists, which makes enqueueing idempotent.
   */
  readonly jobId: string;
  readonly requestId?: string;
  readonly overrides?: Omit<JobsOptions, 'jobId'>;
}

/** One job of a flow: the parent runs only after all of its children have finished. */
export interface FlowJobSpecification {
  readonly queueName: QueueName;
  readonly jobName: string;
  readonly jobId: string;
  readonly payload: unknown;
  readonly options?: Omit<JobsOptions, 'jobId'>;
  readonly children?: readonly FlowJobSpecification[];
}

/** Enqueues jobs and flows wrapped in the cross-service {@link JobEnvelope}. */
@Injectable()
export class QueueProducerService implements OnApplicationShutdown {
  private readonly queuesByName = new Map<QueueName, Queue<JobEnvelope<unknown>>>();
  private flowProducer: FlowProducer | undefined;

  constructor(@Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration) {}

  async enqueue(
    queueName: QueueName,
    jobName: string,
    payload: unknown,
    enqueueOptions: EnqueueOptions,
  ): Promise<string> {
    const queue = this.getQueue(queueName);
    const job = await queue.add(jobName, createJobEnvelope(payload, enqueueOptions.requestId), {
      ...enqueueOptions.overrides,
      jobId: enqueueOptions.jobId,
    });
    return job.id ?? enqueueOptions.jobId;
  }

  /** BullMQ ignores a new job whose id a kept failed job still holds, so that job is retried instead. */
  async retryIfFailed(queueName: QueueName, jobId: string): Promise<void> {
    const job = await this.getQueue(queueName).getJob(jobId);
    if (job !== undefined && (await job.isFailed())) await job.retry();
  }

  /**
   * Creates or updates a job scheduler that adds the job every `everyMilliseconds`.
   * Upserting by `schedulerId` keeps exactly one schedule however many workers start.
   */
  async scheduleRepeating(
    queueName: QueueName,
    schedulerId: string,
    jobName: string,
    everyMilliseconds: number,
  ): Promise<void> {
    await this.getQueue(queueName).upsertJobScheduler(
      schedulerId,
      { every: everyMilliseconds },
      { name: jobName, data: createJobEnvelope({}, undefined), opts: { attempts: 1 } },
    );
  }

  /**
   * Adds a parent job with its children atomically. Children are created with
   * `ignoreDependencyOnFailure`, so the parent always runs once every child has finished
   * and can report failed children itself instead of failing silently.
   */
  async enqueueFlow(flow: FlowJobSpecification, requestId?: string): Promise<void> {
    this.flowProducer ??= new FlowProducer({
      connection: { url: this.configuration.redis.url.reveal(), maxRetriesPerRequest: null },
      prefix: this.configuration.redis.keyPrefix,
    });
    await this.flowProducer.add(toFlowJob(flow, requestId, false));
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queuesByName.values()].map((queue) => queue.close()));
    await this.flowProducer?.close();
  }

  private getQueue(queueName: QueueName): Queue<JobEnvelope<unknown>> {
    let queue = this.queuesByName.get(queueName);
    if (queue === undefined) {
      queue = new Queue<JobEnvelope<unknown>>(queueName, {
        connection: { url: this.configuration.redis.url.reveal(), maxRetriesPerRequest: null },
        prefix: this.configuration.redis.keyPrefix,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queuesByName.set(queueName, queue);
    }
    return queue;
  }
}

function toFlowJob(
  specification: FlowJobSpecification,
  requestId: string | undefined,
  isChild: boolean,
): FlowJob {
  return {
    name: specification.jobName,
    queueName: specification.queueName,
    data: createJobEnvelope(specification.payload, requestId),
    opts: {
      ...DEFAULT_JOB_OPTIONS,
      ...specification.options,
      ...(isChild ? { ignoreDependencyOnFailure: true } : {}),
      jobId: specification.jobId,
    },
    ...(specification.children === undefined
      ? {}
      : { children: specification.children.map((child) => toFlowJob(child, requestId, true)) }),
  };
}
