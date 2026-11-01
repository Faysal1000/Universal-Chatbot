import { Inject, Injectable } from '@nestjs/common';

import type { PageInspection } from '../../../contracts/generated/parse-inspect.v1.js';
import type { BlockManifestRecord } from '../../../contracts/generated/block-manifest-record.v1.js';
import type { ParsePagesResult } from '../../../contracts/generated/parse-pages.v1.js';
import { ParserContracts } from '../../../contracts/parser-contracts.js';
import { assignSectionPaths } from '../../../domain/chunking/document-blocks.js';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../../ports/object-storage.port.js';
import { PermanentJobError } from '../../../queue/permanent-job-error.js';
import { DocumentsRepository } from '../../documents/documents.repository.js';
import type { FlowChildrenOutcome } from '../flow-children-outcome.js';
import { IngestionFailureService } from '../ingestion-failure.service.js';
import { type AssemblePayload, STAGE_PROGRESS } from '../ingestion-jobs.js';
import { IngestionPipelineService } from '../ingestion-pipeline.service.js';
import { IngestionRunsRepository } from '../ingestion-runs.repository.js';
import {
  type NewBlockRecord,
  type NewDocumentPageRecord,
  ParsedContentRepository,
} from '../parsed-content.repository.js';

/** Runs after every `parse.pages` batch: loads the manifests and stores pages and blocks. */
@Injectable()
export class AssembleDocumentService {
  constructor(
    private readonly parserContracts: ParserContracts,
    private readonly parsedContentRepository: ParsedContentRepository,
    private readonly ingestionRunsRepository: IngestionRunsRepository,
    private readonly documentsRepository: DocumentsRepository,
    private readonly ingestionPipeline: IngestionPipelineService,
    private readonly ingestionFailure: IngestionFailureService,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
  ) {}

  async assemble(
    payload: AssemblePayload,
    parsing: FlowChildrenOutcome,
    requestId: string | undefined,
  ): Promise<void> {
    const runReference = { documentId: payload.documentId, ingestionRunId: payload.ingestionRunId };
    if (!(await this.ingestionRunsRepository.isActive(runReference.ingestionRunId))) return;
    const [firstFailure] = parsing.failures;
    if (firstFailure !== undefined) {
      await this.ingestionFailure.failRun(
        runReference,
        firstFailure.failureCode,
        firstFailure.failureMessage,
      );
      return;
    }
    await this.ingestionRunsRepository.startStage(
      runReference.ingestionRunId,
      'assemble',
      STAGE_PROGRESS.assemble,
    );
    await this.ingestionRunsRepository.recordParsingProgress(
      runReference.ingestionRunId,
      payload.pages.length,
      STAGE_PROGRESS.assemble,
    );
    const batchResults = parsing.results
      .map((result) => this.parserContracts.parsePagesResult(result))
      .sort((first, second) => first.batchNumber - second.batchNumber);
    const manifestRecords = await this.loadManifestRecords(batchResults);
    await this.parsedContentRepository.replaceRunContent(
      runReference.documentId,
      runReference.ingestionRunId,
      toPageRecords(payload, batchResults),
      toBlockRecords(payload, manifestRecords),
    );
    await this.ingestionRunsRepository.addVisionModelCalls(
      runReference.ingestionRunId,
      batchResults.reduce((total, result) => total + result.visionModelCallCount, 0),
    );
    await this.documentsRepository.update(runReference.documentId, { status: 'chunking' });
    await this.ingestionPipeline.enqueueNextStage('ingest.chunk', runReference, requestId);
  }

  private async loadManifestRecords(
    batchResults: readonly ParsePagesResult[],
  ): Promise<BlockManifestRecord[]> {
    const records: BlockManifestRecord[] = [];
    for (const batchResult of batchResults) {
      const manifestText = (await this.objectStorage.readBytes(batchResult.manifest.key)).toString('utf8');
      manifestText.split('\n').forEach((line, index) => {
        if (line.trim() === '') return;
        records.push(this.parserContracts.parseManifestRecord(parseJsonLine(line, index + 1), index + 1));
      });
    }
    return records.sort(
      (first, second) => first.pageNumber - second.pageNumber || first.readingOrder - second.readingOrder,
    );
  }
}

function parseJsonLine(line: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new PermanentJobError('contract_violation', `Manifest line ${lineNumber} is not valid JSON`);
  }
}

function toPageRecords(
  payload: AssemblePayload,
  batchResults: readonly ParsePagesResult[],
): NewDocumentPageRecord[] {
  const summariesByPage = new Map(
    batchResults.flatMap((result) => result.pages).map((page) => [page.pageNumber, page]),
  );
  return payload.pages.map((page: PageInspection) => {
    const summary = summariesByPage.get(page.pageNumber);
    return {
      documentId: payload.documentId,
      pageNumber: page.pageNumber,
      ingestionRunId: payload.ingestionRunId,
      pageKind: page.pageKind,
      widthPoints: page.widthPoints,
      heightPoints: page.heightPoints,
      textCoverageRatio: page.textCoverageRatio,
      ocrQualityScore: summary?.ocrQualityScore ?? null,
      parseMethod: summary?.parseMethod ?? 'not_parsed',
      renderStorageKey: summary?.renderKey ?? null,
    };
  });
}

function toBlockRecords(
  payload: AssemblePayload,
  manifestRecords: readonly BlockManifestRecord[],
): NewBlockRecord[] {
  const blocksWithSections = assignSectionPaths(
    manifestRecords.map((record) => ({
      id: record.blockId,
      pageNumber: record.pageNumber,
      readingOrder: record.readingOrder,
      blockType: record.blockType,
      text: record.text,
      markdown: record.markdown,
      latex: record.latex,
      headingLevel: record.headingLevel,
      bbox: record.bbox,
      cropStorageKey: record.cropKey,
      extractionMethod: record.extractionMethod,
      confidence: record.confidence,
      language: record.language,
    })),
  );
  return blocksWithSections.map((block) => ({
    id: block.id,
    documentId: payload.documentId,
    ingestionRunId: payload.ingestionRunId,
    pageNumber: block.pageNumber,
    blockType: block.blockType,
    readingOrder: block.readingOrder,
    text: block.text,
    markdown: block.markdown,
    latex: block.latex,
    headingLevel: block.headingLevel,
    bboxX0: block.bbox.x0,
    bboxY0: block.bbox.y0,
    bboxX1: block.bbox.x1,
    bboxY1: block.bbox.y1,
    sectionPath: block.sectionPath,
    extractionMethod: block.extractionMethod,
    confidence: block.confidence,
    cropStorageKey: block.cropStorageKey,
    language: block.language,
  }));
}
