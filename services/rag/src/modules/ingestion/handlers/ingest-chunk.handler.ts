import { Injectable } from '@nestjs/common';

import type { JobContext, QueueJobHandler } from '../../../queue/queue-job-handler.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { IngestionFailureService } from '../ingestion-failure.service.js';
import { type IngestionRunReference, ingestionRunReferenceSchema } from '../ingestion-jobs.js';
import { ChunkDocumentService } from '../stages/chunk-document.service.js';

@Injectable()
export class IngestChunkHandler implements QueueJobHandler<IngestionRunReference> {
  readonly queueName = QUEUE_NAMES.ingestChunk;
  readonly payloadSchema = ingestionRunReferenceSchema;

  constructor(
    private readonly chunkDocument: ChunkDocumentService,
    private readonly ingestionFailure: IngestionFailureService,
  ) {}

  async handle({ payload, requestId }: JobContext<IngestionRunReference>): Promise<void> {
    await this.chunkDocument.chunk(payload, requestId);
  }

  async onFinalFailure(payload: IngestionRunReference, error: Error): Promise<void> {
    await this.ingestionFailure.failRunWithError(payload, error);
  }
}
