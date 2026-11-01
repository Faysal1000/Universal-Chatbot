import { Injectable } from '@nestjs/common';

import type { JobContext, QueueJobHandler } from '../../../queue/queue-job-handler.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { type IndexBuildPayload, indexBuildPayloadSchema } from './index-build-jobs.js';
import { IndexBuildService } from './index-build.service.js';

@Injectable()
export class IndexBuildHandler implements QueueJobHandler<IndexBuildPayload> {
  readonly queueName = QUEUE_NAMES.indexRebuild;
  readonly payloadSchema = indexBuildPayloadSchema;
  // One build at a time; it shares the embedding server with live ingestion.
  readonly concurrency = 1;
  readonly lockDurationMilliseconds = 10 * 60_000;

  constructor(private readonly indexBuild: IndexBuildService) {}

  handle({ payload }: JobContext<IndexBuildPayload>): Promise<{ indexedDocuments: number }> {
    return this.indexBuild.build(payload.indexVersionId);
  }

  async onFinalFailure(payload: IndexBuildPayload): Promise<void> {
    await this.indexBuild.markFailedIfBuilding(payload.indexVersionId);
  }
}
