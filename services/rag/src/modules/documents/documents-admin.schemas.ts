import { z } from 'zod';

import {
  BLOCK_TYPES,
  CHUNK_KINDS,
  DOCUMENT_STATUSES,
  INGESTION_RUN_STATUSES,
  INGESTION_STAGES,
  PAGE_KINDS,
} from '../../database/schema.js';
import { SUPPORTED_DOCUMENT_CONTENT_TYPES } from './document-content-type.js';

const booleanQueryFlag = z.enum(['true', 'false']).transform((flag) => flag === 'true');

// ----- Requests -----

export const documentIdParameterSchema = z.uuid();
export const pageNumberParameterSchema = z.coerce.number().int().min(1).max(100_000);

/** At most this many ids in one `ids` filter. */
const MAX_DOCUMENT_IDS_PER_FILTER = 100;

export const documentListQuerySchema = z.object({
  ids: z
    .string()
    .transform((text) => text.split(',').map((id) => id.trim()))
    .pipe(z.array(z.uuid()).min(1).max(MAX_DOCUMENT_IDS_PER_FILTER))
    .optional()
    .describe(`Comma-separated document ids (at most ${String(MAX_DOCUMENT_IDS_PER_FILTER)})`),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  isEnabled: booleanQueryFlag.optional(),
  mimeType: z.enum(SUPPORTED_DOCUMENT_CONTENT_TYPES).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

export const documentUpdateSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    title: z.string().trim().min(1).max(300).nullable().optional(),
  })
  .refine((changes) => changes.isEnabled !== undefined || changes.title !== undefined, {
    message: 'Send isEnabled, title or both.',
  });
export type DocumentUpdate = z.infer<typeof documentUpdateSchema>;

export const chunkListQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ----- Responses -----

const timestamp = z.iso.datetime();

export const ingestionRunSchema = z.object({
  id: z.uuid(),
  status: z.enum(INGESTION_RUN_STATUSES),
  stage: z.enum(INGESTION_STAGES),
  progressPercent: z.number().int().min(0).max(100),
  pipelineVersion: z.string(),
  pages: z.object({
    total: z.number().int().nullable(),
    parsed: z.number().int(),
    digital: z.number().int(),
    scanned: z.number().int(),
    hybrid: z.number().int(),
  }),
  visionModelCallCount: z.number().int(),
  failure: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
});
export type IngestionRunView = z.infer<typeof ingestionRunSchema>;

export const ingestionRunListQuerySchema = z.object({
  status: z
    .enum(['active', 'failed', 'finished', 'all'])
    .default('active')
    .describe('active = queued or running; finished = succeeded, failed or cancelled'),
  documentId: z.uuid().optional().describe('Only the runs of this document'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ingestionRunWithDocumentSchema = ingestionRunSchema.extend({ documentId: z.uuid() });
export type IngestionRunWithDocumentView = z.infer<typeof ingestionRunWithDocumentSchema>;

export const documentSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  originalFilename: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  pageCount: z.number().int().nullable(),
  detectedLanguage: z.string().nullable(),
  status: z.enum(DOCUMENT_STATUSES),
  isEnabled: z.boolean(),
  failure: z.object({ code: z.string(), message: z.string() }).nullable(),
  uploadedByAdminUserId: z.uuid().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type DocumentView = z.infer<typeof documentSchema>;

export const documentListSchema = z.object({
  items: z.array(documentSchema),
  nextCursor: z.string().nullable(),
});

export const documentDetailSchema = documentSchema.extend({
  runs: z.array(ingestionRunSchema).describe('Most recent first'),
  storage: z.object({
    bucket: z.string(),
    originalObjectKey: z.string(),
    documentPrefix: z.string(),
    indexVersionId: z.number().int().nullable(),
    chunkCount: z.number().int(),
    pagesByKind: z.record(z.enum(PAGE_KINDS), z.number().int()),
  }),
});
export type DocumentDetailView = z.infer<typeof documentDetailSchema>;

export const documentPageSchema = z.object({
  pageNumber: z.number().int(),
  pageKind: z.enum(PAGE_KINDS),
  widthPoints: z.number(),
  heightPoints: z.number(),
  textCoverageRatio: z.number().nullable(),
  ocrQualityScore: z.number().nullable(),
  parseMethod: z.string(),
  hasImage: z.boolean(),
});
export type DocumentPageView = z.infer<typeof documentPageSchema>;

export const blockSchema = z.object({
  id: z.uuid(),
  blockType: z.enum(BLOCK_TYPES),
  readingOrder: z.number().int(),
  text: z.string().nullable(),
  markdown: z.string().nullable(),
  latex: z.string().nullable(),
  bbox: z
    .object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() })
    .describe('Normalised 0–1'),
  sectionPath: z.array(z.string()),
  headingLevel: z.number().int().nullable(),
  extractionMethod: z.string(),
  confidence: z.number().nullable(),
  hasCrop: z.boolean(),
  language: z.string().nullable(),
});
export type BlockView = z.infer<typeof blockSchema>;

export const documentPageDetailSchema = documentPageSchema.extend({ blocks: z.array(blockSchema) });

export const chunkSchema = z.object({
  id: z.uuid(),
  chunkKind: z.enum(CHUNK_KINDS),
  contextualHeader: z.string(),
  text: z.string(),
  pageStart: z.number().int(),
  pageEnd: z.number().int(),
  blockIds: z.array(z.uuid()),
  blockTypes: z.array(z.enum(BLOCK_TYPES)).describe('Distinct types of the blocks the chunk was built from'),
  tokenCount: z.number().int(),
  hasCrop: z.boolean(),
});
export type ChunkView = z.infer<typeof chunkSchema>;

export const chunkListSchema = z.object({
  items: z.array(chunkSchema),
  total: z.number().int(),
  indexVersionId: z.number().int().nullable(),
});

export const acceptedIngestionSchema = z.object({ documentId: z.uuid(), ingestionRunId: z.uuid() });
export const acceptedDeletionSchema = z.object({ documentId: z.uuid(), status: z.literal('deleting') });

/** Payload of each `progress` event on the document events stream. */
export const documentProgressEventSchema = z.object({
  documentId: z.uuid(),
  status: z.enum(DOCUMENT_STATUSES),
  run: ingestionRunSchema.nullable(),
});
export type DocumentProgressEvent = z.infer<typeof documentProgressEventSchema>;
