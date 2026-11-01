/** How document and ingestion-run states read in the console's placard vocabulary. */
import type { StatusPlacard } from '../shared/statusPlacard';
import type {
  DocumentStatus,
  DocumentSummary,
  IngestionRunStatus,
  IngestionStage,
  SupportedMimeType,
} from './api/documentTypes';

const DOCUMENT_STATUS_PLACARDS: Record<DocumentStatus, StatusPlacard> = {
  uploaded: { state: 'working', label: 'Uploaded' },
  inspecting: { state: 'working', label: 'Inspecting' },
  parsing: { state: 'working', label: 'Parsing' },
  chunking: { state: 'working', label: 'Chunking' },
  indexing: { state: 'working', label: 'Indexing' },
  ready: { state: 'ready', label: 'Ready' },
  failed: { state: 'failed', label: 'Failed' },
  deleting: { state: 'working', label: 'Deleting' },
};

const SETTLED_DOCUMENT_STATUSES: ReadonlySet<DocumentStatus> = new Set(['ready', 'failed']);

export function documentStatusPlacard(status: DocumentStatus): StatusPlacard {
  return DOCUMENT_STATUS_PLACARDS[status];
}

function isDocumentStatus(status: string): status is DocumentStatus {
  return Object.hasOwn(DOCUMENT_STATUS_PLACARDS, status);
}

/** For status names that arrive as plain strings (the overview counts); an unknown status reads as in progress. */
export function placardForStatusName(status: string): StatusPlacard {
  return isDocumentStatus(status) ? DOCUMENT_STATUS_PLACARDS[status] : { state: 'working', label: status };
}

/** Ready and failed documents no longer change on their own. */
export function isDocumentSettled(status: DocumentStatus): boolean {
  return SETTLED_DOCUMENT_STATUSES.has(status);
}

/** Uploaded through indexing: an ingestion run is (about to be) working on the document. */
export function isDocumentIngesting(status: DocumentStatus): boolean {
  return !isDocumentSettled(status) && status !== 'deleting';
}

export function hasWorkingDocuments(documents: readonly Pick<DocumentSummary, 'status'>[]): boolean {
  return documents.some((document) => !isDocumentSettled(document.status));
}

const RUN_STATUS_PLACARDS: Record<IngestionRunStatus, StatusPlacard> = {
  queued: { state: 'stopped', label: 'Queued' },
  running: { state: 'working', label: 'Running' },
  succeeded: { state: 'ready', label: 'Succeeded' },
  failed: { state: 'failed', label: 'Failed' },
  cancelled: { state: 'disabled', label: 'Cancelled' },
};

export function ingestionRunPlacard(status: IngestionRunStatus): StatusPlacard {
  return RUN_STATUS_PLACARDS[status];
}

const STAGE_LABELS: Record<IngestionStage, string> = {
  inspect: 'Inspecting the file',
  parse: 'Parsing pages',
  assemble: 'Assembling blocks',
  chunk: 'Chunking',
  embed_index: 'Embedding and indexing',
  finalize: 'Finalizing',
};

export function ingestionStageLabel(stage: IngestionStage): string {
  return STAGE_LABELS[stage];
}

const MIME_TYPE_LABELS: Record<SupportedMimeType, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/tiff': 'TIFF',
};

/** "PDF", "PNG", …; an unexpected type is shown as rag sent it. */
export function mimeTypeLabel(mimeType: string): string {
  return mimeType in MIME_TYPE_LABELS ? MIME_TYPE_LABELS[mimeType as SupportedMimeType] : mimeType;
}

/** The title when the admin gave one, else the uploaded file name. */
export function documentDisplayName(document: Pick<DocumentSummary, 'title' | 'originalFilename'>): string {
  return document.title ?? document.originalFilename;
}
