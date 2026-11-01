import type { ChunkWithBlockTypes } from '../index-versions/chunks.repository.js';
import type { IngestionRunRecord } from '../ingestion/ingestion-runs.repository.js';
import type { BlockRecord, DocumentPageRecord } from '../ingestion/parsed-content.repository.js';
import type {
  BlockView,
  ChunkView,
  DocumentPageView,
  DocumentView,
  IngestionRunView,
} from './documents-admin.schemas.js';
import type { DocumentRecord } from './documents.repository.js';

/** Maps stored records to the admin API's response shapes. */
export const documentPresenter = {
  document: (document: DocumentRecord): DocumentView => {
    return {
      id: document.id,
      title: document.title,
      originalFilename: document.originalFilename,
      mimeType: document.mimeType,
      byteSize: document.byteSize,
      sha256: document.sha256,
      pageCount: document.pageCount,
      detectedLanguage: document.detectedLanguage,
      status: document.status,
      isEnabled: document.isEnabled,
      failure: failureOf(document),
      uploadedByAdminUserId: document.uploadedByAdminUserId,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  },

  ingestionRun: (run: IngestionRunRecord): IngestionRunView => {
    return {
      id: run.id,
      status: run.status,
      stage: run.stage,
      progressPercent: run.progressPercent,
      pipelineVersion: run.pipelineVersion,
      pages: {
        total: run.pagesTotal,
        parsed: run.pagesParsed,
        digital: run.pagesDigital,
        scanned: run.pagesScanned,
        hybrid: run.pagesHybrid,
      },
      visionModelCallCount: run.vlmCallCount,
      failure: failureOf(run),
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  },

  page: (page: DocumentPageRecord): DocumentPageView => {
    return {
      pageNumber: page.pageNumber,
      pageKind: page.pageKind,
      widthPoints: page.widthPoints,
      heightPoints: page.heightPoints,
      textCoverageRatio: page.textCoverageRatio,
      ocrQualityScore: page.ocrQualityScore,
      parseMethod: page.parseMethod,
      hasImage: page.renderStorageKey !== null,
    };
  },

  block: (block: BlockRecord): BlockView => {
    return {
      id: block.id,
      blockType: block.blockType,
      readingOrder: block.readingOrder,
      text: block.text,
      markdown: block.markdown,
      latex: block.latex,
      bbox: { x0: block.bboxX0, y0: block.bboxY0, x1: block.bboxX1, y1: block.bboxY1 },
      sectionPath: block.sectionPath,
      headingLevel: block.headingLevel,
      extractionMethod: block.extractionMethod,
      confidence: block.confidence,
      hasCrop: block.cropStorageKey !== null,
      language: block.language,
    };
  },

  chunk: (chunk: ChunkWithBlockTypes): ChunkView => {
    return {
      id: chunk.id,
      chunkKind: chunk.chunkKind,
      contextualHeader: chunk.contextualHeader,
      text: chunk.text,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      blockIds: chunk.blockIds,
      blockTypes: chunk.blockTypes,
      tokenCount: chunk.tokenCount,
      hasCrop: chunk.cropStorageKey !== null,
    };
  },
};

function failureOf(record: {
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
}): { code: string; message: string } | null {
  return record.failureCode === null
    ? null
    : { code: record.failureCode, message: record.failureMessage ?? '' };
}
