import { z } from 'zod';

import type { PageInspection } from '../../contracts/generated/parse-inspect.v1.js';

/** Bump when parsing, assembly or chunking changes in a way that warrants reprocessing. */
export const INGESTION_PIPELINE_VERSION = 'm1-lean-parser-v1';

/** Deterministic job ids make every enqueue idempotent (BullMQ forbids `:` in ids). */
export const ingestionJobIds = {
  plan: (runReference: IngestionRunReference) =>
    `${runReference.documentId}.${runReference.ingestionRunId}.plan`,
  inspect: (runReference: IngestionRunReference) =>
    `${runReference.documentId}.${runReference.ingestionRunId}.inspect`,
  assemble: (runReference: IngestionRunReference) =>
    `${runReference.documentId}.${runReference.ingestionRunId}.assemble`,
  parsePages: (runReference: IngestionRunReference, batchNumber: number) =>
    `${runReference.documentId}.${runReference.ingestionRunId}.pages.${batchNumber}`,
  chunk: (runReference: IngestionRunReference) =>
    `${runReference.documentId}.${runReference.ingestionRunId}.chunk`,
  embedIndex: (runReference: IngestionRunReference) =>
    `${runReference.documentId}.${runReference.ingestionRunId}.embed`,
  finalize: (runReference: IngestionRunReference) =>
    `${runReference.documentId}.${runReference.ingestionRunId}.finalize`,
  deleteDocument: (documentId: string) => `${documentId}.delete`,
} as const;

const PARSE_PAGES_JOB_ID_PATTERN = /^([0-9a-f-]{36})\.([0-9a-f-]{36})\.pages\.(\d+)$/;

/** Reads the run and batch back from a `parse.pages` job id (progress events carry only the id). */
export function parseParsePagesJobId(
  jobId: string,
): (IngestionRunReference & { readonly batchNumber: number }) | undefined {
  const match = PARSE_PAGES_JOB_ID_PATTERN.exec(jobId);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return undefined;
  return { documentId: match[1], ingestionRunId: match[2], batchNumber: Number(match[3]) };
}

export const ingestionRunReferenceSchema = z.object({
  documentId: z.uuid(),
  ingestionRunId: z.uuid(),
});
export type IngestionRunReference = z.infer<typeof ingestionRunReferenceSchema>;

export const assemblePayloadSchema = ingestionRunReferenceSchema.extend({
  /** Page geometry from inspection, needed to store document_pages rows. */
  pages: z.array(z.custom<PageInspection>((value) => typeof value === 'object' && value !== null)).min(1),
});
export type AssemblePayload = z.infer<typeof assemblePayloadSchema>;

export const deleteDocumentPayloadSchema = z.object({ documentId: z.uuid() });
export type DeleteDocumentPayload = z.infer<typeof deleteDocumentPayloadSchema>;

/** Overall progress shown to admins, by stage. Parsing dominates on CPU. */
export const STAGE_PROGRESS = {
  inspectStart: 2,
  parseStart: 5,
  parseEnd: 80,
  assemble: 82,
  chunk: 85,
  indexStart: 88,
  indexEnd: 98,
} as const;

export function parsingProgressPercent(pagesParsed: number, pagesTotal: number): number {
  if (pagesTotal <= 0) return STAGE_PROGRESS.parseStart;
  const parsedShare = Math.min(1, pagesParsed / pagesTotal);
  return Math.round(
    STAGE_PROGRESS.parseStart + parsedShare * (STAGE_PROGRESS.parseEnd - STAGE_PROGRESS.parseStart),
  );
}
