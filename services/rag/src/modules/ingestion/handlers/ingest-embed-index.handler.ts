import { Injectable } from '@nestjs/common';

import type { JobContext, QueueJobHandler } from '../../../queue/queue-job-handler.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { IngestionFailureService } from '../ingestion-failure.service.js';
import { type IngestionRunReference, ingestionRunReferenceSchema } from '../ingestion-jobs.js';
import { IndexDocumentChunksService } from '../stages/index-document-chunks.service.js';

/** Embedding a 200-page document on CPU takes minutes; the lock must outlast one round. */
const EMBED_INDEX_LOCK_DURATION_MILLISECONDS = 10 * 60_000;

@Injectable()
export class IngestEmbedIndexHandler implements QueueJobHandler<IngestionRunReference> {
  readonly queueName = QUEUE_NAMES.ingestEmbedIndex;
  readonly payloadSchema = ingestionRunReferenceSchema;
  // The embedding-server serialises requests anyway; parallel jobs only queue up there.
  readonly concurrency = 1;
  readonly lockDurationMilliseconds = EMBED_INDEX_LOCK_DURATION_MILLISECONDS;

  constructor(
    private readonly indexDocumentChunks: IndexDocumentChunksService,
    private readonly ingestionFailure: IngestionFailureService,
  ) {}

  async handle({ payload, requestId }: JobContext<IngestionRunReference>): Promise<void> {
    await this.indexDocumentChunks.index(payload, requestId);
  }

  async onFinalFailure(payload: IngestionRunReference, error: Error): Promise<void> {
    await this.ingestionFailure.failRunWithError(payload, error);
  }
}
