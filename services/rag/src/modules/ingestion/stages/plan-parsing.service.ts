import { Inject, Injectable } from '@nestjs/common';

import type { ServiceConfiguration } from '../../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../../config/configuration.module.js';
import { ParserContracts } from '../../../contracts/parser-contracts.js';
import { planPageBatches } from '../../../domain/ingestion/page-batch-planner.js';
import { DocumentsRepository } from '../../documents/documents.repository.js';
import type { FlowChildrenOutcome } from '../flow-children-outcome.js';
import { IngestionFailureService } from '../ingestion-failure.service.js';
import { type IngestionRunReference, STAGE_PROGRESS } from '../ingestion-jobs.js';
import { IngestionPipelineService } from '../ingestion-pipeline.service.js';
import { IngestionRunsRepository } from '../ingestion-runs.repository.js';

/** Runs after `parse.inspect`: records the page inventory and enqueues page parsing. */
@Injectable()
export class PlanParsingService {
  constructor(
    private readonly parserContracts: ParserContracts,
    private readonly ingestionRunsRepository: IngestionRunsRepository,
    private readonly documentsRepository: DocumentsRepository,
    private readonly ingestionPipeline: IngestionPipelineService,
    private readonly ingestionFailure: IngestionFailureService,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async planParsing(
    runReference: IngestionRunReference,
    inspection: FlowChildrenOutcome,
    requestId: string | undefined,
  ): Promise<void> {
    if (!(await this.ingestionRunsRepository.isActive(runReference.ingestionRunId))) return;
    const [firstFailure] = inspection.failures;
    if (firstFailure !== undefined) {
      await this.ingestionFailure.failRun(
        runReference,
        firstFailure.failureCode,
        firstFailure.failureMessage,
      );
      return;
    }
    const result = this.parserContracts.parseInspectResult(inspection.results[0]);
    await this.ingestionRunsRepository.recordInspection(runReference.ingestionRunId, result.pageCount, {
      digital: result.pages.filter((page) => page.pageKind === 'digital').length,
      scanned: result.pages.filter((page) => page.pageKind === 'scanned').length,
      hybrid: result.pages.filter((page) => page.pageKind === 'hybrid').length,
    });
    await this.ingestionRunsRepository.startStage(
      runReference.ingestionRunId,
      'parse',
      STAGE_PROGRESS.parseStart,
    );
    await this.documentsRepository.update(runReference.documentId, {
      status: 'parsing',
      pageCount: result.pageCount,
      detectedLanguage: result.detectedLanguage ?? null,
    });
    const batches = planPageBatches(result.pages, {
      pagesPerBatch: this.configuration.ingestion.parsePagesPerJob,
      visionModelPageBudget: this.configuration.ingestion.maxVisionModelCallsPerDocument,
    });
    await this.ingestionPipeline.enqueueParsing(
      runReference,
      result.parseSource,
      batches,
      result.pages,
      requestId,
    );
  }
}
