import { Injectable } from '@nestjs/common';

import type { JobContext, QueueJobHandler } from '../../../queue/queue-job-handler.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { readFlowChildrenOutcome } from '../flow-children-outcome.js';
import { IngestionFailureService } from '../ingestion-failure.service.js';
import { type IngestionRunReference, ingestionRunReferenceSchema } from '../ingestion-jobs.js';
import { PlanParsingService } from '../stages/plan-parsing.service.js';

/** Runs after `parse.inspect` finishes (or fails for good) and plans the page batches. */
@Injectable()
export class IngestPlanHandler implements QueueJobHandler<IngestionRunReference> {
  readonly queueName = QUEUE_NAMES.ingestPlan;
  readonly payloadSchema = ingestionRunReferenceSchema;

  constructor(
    private readonly planParsing: PlanParsingService,
    private readonly ingestionFailure: IngestionFailureService,
  ) {}

  async handle({ job, payload, requestId }: JobContext<IngestionRunReference>): Promise<void> {
    await this.planParsing.planParsing(payload, await readFlowChildrenOutcome(job), requestId);
  }

  async onFinalFailure(payload: IngestionRunReference, error: Error): Promise<void> {
    await this.ingestionFailure.failRunWithError(payload, error);
  }
}
