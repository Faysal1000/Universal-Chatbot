import { Injectable } from '@nestjs/common';

import type { JobContext, QueueJobHandler } from '../../../queue/queue-job-handler.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { readFlowChildrenOutcome } from '../flow-children-outcome.js';
import { IngestionFailureService } from '../ingestion-failure.service.js';
import { type AssemblePayload, assemblePayloadSchema } from '../ingestion-jobs.js';
import { AssembleDocumentService } from '../stages/assemble-document.service.js';

/** Runs after every `parse.pages` batch has finished and merges their manifests. */
@Injectable()
export class IngestAssembleHandler implements QueueJobHandler<AssemblePayload> {
  readonly queueName = QUEUE_NAMES.ingestAssemble;
  readonly payloadSchema = assemblePayloadSchema;

  constructor(
    private readonly assembleDocument: AssembleDocumentService,
    private readonly ingestionFailure: IngestionFailureService,
  ) {}

  async handle({ job, payload, requestId }: JobContext<AssemblePayload>): Promise<void> {
    await this.assembleDocument.assemble(payload, await readFlowChildrenOutcome(job), requestId);
  }

  async onFinalFailure(payload: AssemblePayload, error: Error): Promise<void> {
    await this.ingestionFailure.failRunWithError(payload, error);
  }
}
