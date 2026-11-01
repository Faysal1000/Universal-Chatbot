import { Inject, Injectable } from '@nestjs/common';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import type { PageInspection, ParseInspectPayload } from '../../contracts/generated/parse-inspect.v1.js';
import type { ParsePagesPayload } from '../../contracts/generated/parse-pages.v1.js';
import type { PageBatch } from '../../domain/ingestion/page-batch-planner.js';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../ports/object-storage.port.js';
import { QueueProducerService } from '../../queue/queue-producer.service.js';
import { QUEUE_NAMES, type QueueName } from '../../queue/queue-names.js';
import { documentStorageKeys } from '../documents/document-storage-keys.js';
import { type DocumentRecord, DocumentsRepository } from '../documents/documents.repository.js';
import {
  type AssemblePayload,
  INGESTION_PIPELINE_VERSION,
  ingestionJobIds,
  type IngestionRunReference,
} from './ingestion-jobs.js';
import { IngestionRunsRepository } from './ingestion-runs.repository.js';

/** Parse jobs are expensive (vision model calls); fewer retries than the default five. */
const PARSE_JOB_ATTEMPTS = 3;

/**
 * Starts ingestion runs and moves them from stage to stage. Every hand-off is an
 * idempotent enqueue with a deterministic job id, so a retried stage never forks the run.
 */
@Injectable()
export class IngestionPipelineService {
  constructor(
    private readonly queueProducer: QueueProducerService,
    private readonly ingestionRunsRepository: IngestionRunsRepository,
    private readonly documentsRepository: DocumentsRepository,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  /** Creates a run and enqueues inspection (a `parse.inspect` child under an `ingest.plan` parent). */
  async startRun(document: DocumentRecord, requestId: string | undefined): Promise<IngestionRunReference> {
    await this.ingestionRunsRepository.cancelUnfinishedRuns(document.id);
    const run = await this.ingestionRunsRepository.create(document.id, INGESTION_PIPELINE_VERSION);
    const runReference = { documentId: document.id, ingestionRunId: run.id };
    await this.documentsRepository.update(document.id, {
      status: 'inspecting',
      failureCode: null,
      failureMessage: null,
    });
    const inspectPayload: ParseInspectPayload = {
      documentId: document.id,
      ingestionRunId: run.id,
      source: {
        object: { bucket: this.objectStorage.bucketName, key: document.storageKey },
        sha256: document.sha256,
        mimeType: document.mimeType as ParseInspectPayload['source']['mimeType'],
        byteSize: document.byteSize,
      },
      outputPrefix: documentStorageKeys.runPrefix(document.id, run.id),
      limits: { maxPages: this.configuration.ingestion.maxPagesPerDocument },
    };
    await this.queueProducer.enqueueFlow(
      {
        queueName: QUEUE_NAMES.ingestPlan,
        jobName: 'plan',
        jobId: ingestionJobIds.plan(runReference),
        payload: runReference,
        children: [
          {
            queueName: QUEUE_NAMES.parseInspect,
            jobName: 'inspect',
            jobId: ingestionJobIds.inspect(runReference),
            payload: inspectPayload,
            options: { attempts: PARSE_JOB_ATTEMPTS },
          },
        ],
      },
      requestId,
    );
    return runReference;
  }

  /** Enqueues every page batch as a `parse.pages` child of one `ingest.assemble` parent. */
  async enqueueParsing(
    runReference: IngestionRunReference,
    parseSource: ParsePagesPayload['parseSource'],
    batches: readonly PageBatch[],
    pages: readonly PageInspection[],
    requestId: string | undefined,
  ): Promise<void> {
    const assemblePayload: AssemblePayload = { ...runReference, pages: [...pages] };
    await this.queueProducer.enqueueFlow(
      {
        queueName: QUEUE_NAMES.ingestAssemble,
        jobName: 'assemble',
        jobId: ingestionJobIds.assemble(runReference),
        payload: assemblePayload,
        children: batches.map((batch) => ({
          queueName: QUEUE_NAMES.parsePages,
          jobName: 'parse-pages',
          jobId: ingestionJobIds.parsePages(runReference, batch.batchNumber),
          payload: this.toParsePagesPayload(runReference, parseSource, batch),
          options: { attempts: PARSE_JOB_ATTEMPTS },
        })),
      },
      requestId,
    );
  }

  async enqueueNextStage(
    queueName: Extract<QueueName, 'ingest.chunk' | 'ingest.embed_index' | 'ingest.finalize'>,
    runReference: IngestionRunReference,
    requestId: string | undefined,
  ): Promise<void> {
    const jobIdByQueue = {
      [QUEUE_NAMES.ingestChunk]: ingestionJobIds.chunk,
      [QUEUE_NAMES.ingestEmbedIndex]: ingestionJobIds.embedIndex,
      [QUEUE_NAMES.ingestFinalize]: ingestionJobIds.finalize,
    } as const;
    await this.queueProducer.enqueue(queueName, queueName, runReference, {
      jobId: jobIdByQueue[queueName](runReference),
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  async enqueueDeletion(documentId: string, requestId: string | undefined): Promise<void> {
    await this.ingestionRunsRepository.cancelUnfinishedRuns(documentId);
    await this.queueProducer.retryIfFailed(
      QUEUE_NAMES.documentDelete,
      ingestionJobIds.deleteDocument(documentId),
    );
    await this.queueProducer.enqueue(
      QUEUE_NAMES.documentDelete,
      'delete',
      { documentId },
      {
        jobId: ingestionJobIds.deleteDocument(documentId),
        ...(requestId === undefined ? {} : { requestId }),
      },
    );
  }

  private toParsePagesPayload(
    runReference: IngestionRunReference,
    parseSource: ParsePagesPayload['parseSource'],
    batch: PageBatch,
  ): ParsePagesPayload {
    const { parsePageTimeoutSeconds, parseRenderDpi } = this.configuration.ingestion;
    return {
      ...runReference,
      batchNumber: batch.batchNumber,
      parseSource,
      pages: batch.pages,
      outputPrefix: documentStorageKeys.runPrefix(runReference.documentId, runReference.ingestionRunId),
      limits: {
        maxVisionModelCalls: batch.visionModelCallBudget,
        pageTimeoutSeconds: parsePageTimeoutSeconds,
        renderDpi: parseRenderDpi,
      },
    };
  }
}
