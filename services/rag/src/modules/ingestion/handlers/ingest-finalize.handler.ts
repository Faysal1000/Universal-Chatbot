import { Injectable } from '@nestjs/common';

import type { JobContext, QueueJobHandler } from '../../../queue/queue-job-handler.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { IngestionFailureService } from '../ingestion-failure.service.js';
import { type IngestionRunReference, ingestionRunReferenceSchema } from '../ingestion-jobs.js';
import { FinalizeIngestionService } from '../stages/finalize-ingestion.service.js';

@Injectable()
export class IngestFinalizeHandler implements QueueJobHandler<IngestionRunReference> {
  readonly queueName = QUEUE_NAMES.ingestFinalize;
  readonly payloadSchema = ingestionRunReferenceSchema;

  constructor(
    private readonly finalizeIngestion: FinalizeIngestionService,
    private readonly ingestionFailure: IngestionFailureService,
  ) {}

  async handle({ payload }: JobContext<IngestionRunReference>): Promise<void> {
    await this.finalizeIngestion.finalize(payload);
  }

  async onFinalFailure(payload: IngestionRunReference, error: Error): Promise<void> {
    await this.ingestionFailure.failRunWithError(payload, error);
  }
}
