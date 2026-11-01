import { Injectable, Logger } from '@nestjs/common';

import { describeJobFailure } from '../../queue/queue-worker-host.service.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import type { IngestionRunReference } from './ingestion-jobs.js';
import { IngestionRunsRepository } from './ingestion-runs.repository.js';

/** Records a failed run, and fails the document unless a newer run has replaced it. */
@Injectable()
export class IngestionFailureService {
  private readonly logger = new Logger(IngestionFailureService.name);

  constructor(
    private readonly ingestionRunsRepository: IngestionRunsRepository,
    private readonly documentsRepository: DocumentsRepository,
  ) {}

  /** Final failure of a pipeline job: the code travels in the message as `<code>: <message>`. */
  async failRunWithError(runReference: IngestionRunReference, error: Error): Promise<void> {
    const { failureCode, failureMessage } = describeJobFailure(error.message);
    await this.failRun(
      { documentId: runReference.documentId, ingestionRunId: runReference.ingestionRunId },
      failureCode,
      failureMessage,
    );
  }

  async failRun(
    runReference: IngestionRunReference,
    failureCode: string,
    failureMessage: string,
  ): Promise<void> {
    const run = await this.ingestionRunsRepository.findById(runReference.ingestionRunId);
    if (run === undefined || run.status === 'cancelled' || run.status === 'succeeded') return;
    await this.ingestionRunsRepository.markFailed(runReference.ingestionRunId, failureCode, failureMessage);
    const [latestRun] = await this.ingestionRunsRepository.listForDocument(runReference.documentId, 1);
    if (latestRun?.id === runReference.ingestionRunId) {
      await this.documentsRepository.update(runReference.documentId, {
        status: 'failed',
        failureCode,
        failureMessage: failureMessage.slice(0, 2_000),
      });
    }
    this.logger.warn({ ...runReference, failureCode }, `Ingestion run failed: ${failureMessage}`);
  }
}
