/** Document, page, chunk and ingestion-run shapes from the generated rag contract. */
import type { operations } from '@/contracts/rag';

import type { RagQueryParameters, RagRequestBody, RagResponseBody } from '../../shared/ragContract';

export type DocumentListResponse = RagResponseBody<'DocumentsAdminController_list'>;
export type DocumentSummary = DocumentListResponse['items'][number];
export type DocumentStatus = DocumentSummary['status'];
export type DocumentListQuery = RagQueryParameters<'DocumentsAdminController_list'>;
export type SupportedMimeType = NonNullable<DocumentListQuery['mimeType']>;

export type DocumentDetail = RagResponseBody<'DocumentsAdminController_describe'>;
export type IngestionRun = DocumentDetail['runs'][number];
export type IngestionStage = IngestionRun['stage'];
export type IngestionRunStatus = IngestionRun['status'];
/** `RUNS_SHOWN_IN_DETAIL` in rag: the document detail lists only this many of the latest runs. */
export const RUNS_SHOWN_IN_DOCUMENT_DETAIL = 10;
/** The most runs `/ingestion-runs` returns in one response. */
export const MAXIMUM_LISTED_INGESTION_RUNS = 200;

export type DocumentUpdateRequest = RagRequestBody<'DocumentsAdminController_update'>;
export type ReprocessResponse = RagResponseBody<'DocumentsAdminController_reprocess'>;
export type DeletionResponse = RagResponseBody<'DocumentsAdminController_delete'>;

export type DocumentPage = RagResponseBody<'DocumentsAdminController_listPages'>[number];
export type DocumentPageDetail = RagResponseBody<'DocumentsAdminController_describePage'>;
export type PageBlock = DocumentPageDetail['blocks'][number];

export type ChunkListResponse = RagResponseBody<'DocumentsAdminController_listChunks'>;
export type DocumentChunk = ChunkListResponse['items'][number];
export type BlockType = PageBlock['blockType'];

/** Payload of the `progress` server-sent event on `/documents/{id}/events`. */
export type DocumentProgressEvent =
  operations['DocumentsAdminController_streamEvents']['responses'][200]['content']['text/event-stream'];

export const SUPPORTED_MIME_TYPES: readonly SupportedMimeType[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
];

export const DOCUMENT_STATUSES = [
  'uploaded',
  'inspecting',
  'parsing',
  'chunking',
  'indexing',
  'ready',
  'failed',
  'deleting',
] as const satisfies readonly DocumentStatus[];

export const INGESTION_STAGES = [
  'inspect',
  'parse',
  'assemble',
  'chunk',
  'embed_index',
  'finalize',
] as const satisfies readonly IngestionStage[];

/** rag's page size for the document list (its default is 25, maximum 100). */
export const DOCUMENT_PAGE_SIZE = 25;

/** rag's page size for chunks (its default is 50, maximum 200). */
export const CHUNK_PAGE_SIZE = 20;
