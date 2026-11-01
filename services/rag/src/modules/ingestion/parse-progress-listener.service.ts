import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.tokens.js';
import { QUEUE_NAMES } from '../../queue/queue-names.js';
import { parseParsePagesJobId, parsingProgressPercent } from './ingestion-jobs.js';
import { IngestionRunsRepository } from './ingestion-runs.repository.js';

/** Progress the document-parser reports through `job.updateProgress` for one page batch. */
const batchProgressSchema = z.object({
  pagesDone: z.number().int().nonnegative(),
  pagesTotal: z.number().int().positive(),
});

const BATCH_PROGRESS_TTL_SECONDS = 24 * 60 * 60;

/**
 * Turns per-batch parser progress into per-run progress. Batches run in parallel, so each
 * batch's count is kept in a Redis hash per run and the sum is written to the run.
 */
@Injectable()
export class ParseProgressListener implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ParseProgressListener.name);
  private queueEvents: QueueEvents | undefined;

  constructor(
    private readonly ingestionRunsRepository: IngestionRunsRepository,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  onApplicationBootstrap(): void {
    this.queueEvents = new QueueEvents(QUEUE_NAMES.parsePages, {
      connection: { url: this.configuration.redis.url.reveal(), maxRetriesPerRequest: null },
      prefix: this.configuration.redis.keyPrefix,
    });
    this.queueEvents.on('progress', ({ jobId, data }) => {
      this.recordBatchProgress(jobId, data).catch((error: unknown) => {
        this.logger.warn({ err: error, jobId }, 'Could not record parse progress');
      });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queueEvents?.close();
  }

  private async recordBatchProgress(jobId: string, data: unknown): Promise<void> {
    const batch = parseParsePagesJobId(jobId);
    const progress = batchProgressSchema.safeParse(data);
    if (batch === undefined || !progress.success) return;
    const progressKey = `parse-progress:${batch.ingestionRunId}`;
    await this.redisClient
      .multi()
      .hset(progressKey, String(batch.batchNumber), progress.data.pagesDone)
      .expire(progressKey, BATCH_PROGRESS_TTL_SECONDS)
      .exec();
    const pagesParsed = sumOfCounts(await this.redisClient.hvals(progressKey));
    const run = await this.ingestionRunsRepository.findById(batch.ingestionRunId);
    if (run?.pagesTotal === null || run?.pagesTotal === undefined) return;
    await this.ingestionRunsRepository.recordParsingProgress(
      batch.ingestionRunId,
      Math.min(pagesParsed, run.pagesTotal),
      parsingProgressPercent(pagesParsed, run.pagesTotal),
    );
  }
}

function sumOfCounts(counts: readonly string[]): number {
  return counts.reduce((total, count) => total + Number(count), 0);
}
