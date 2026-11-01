import { requestRagApi, uploadWithProgress } from '@/shared/api/httpClient';
import type { UploadProgress } from '@/shared/api/httpClient';

import { ragBrowserUrls } from '../../shared/ragBrowserUrls';
import type {
  ChunkListResponse,
  DeletionResponse,
  DocumentDetail,
  DocumentListQuery,
  DocumentListResponse,
  DocumentPage,
  DocumentPageDetail,
  DocumentSummary,
  DocumentUpdateRequest,
  IngestionRun,
  ReprocessResponse,
} from './documentTypes';
import { MAXIMUM_LISTED_INGESTION_RUNS } from './documentTypes';

const encode = encodeURIComponent;

function documentPath(documentId: string): string {
  return `/documents/${encode(documentId)}`;
}

export function listDocuments(query: DocumentListQuery, signal?: AbortSignal): Promise<DocumentListResponse> {
  return requestRagApi<DocumentListResponse>('/documents', { queryParameters: { ...query }, signal });
}

export function getDocument(documentId: string): Promise<DocumentDetail> {
  return requestRagApi<DocumentDetail>(documentPath(documentId));
}

export function updateDocument(documentId: string, request: DocumentUpdateRequest): Promise<DocumentSummary> {
  return requestRagApi<DocumentSummary>(documentPath(documentId), { method: 'PATCH', body: request });
}

export function reprocessDocument(documentId: string): Promise<ReprocessResponse> {
  return requestRagApi<ReprocessResponse>(`${documentPath(documentId)}/reprocess`, { method: 'POST' });
}

export function deleteDocument(documentId: string): Promise<DeletionResponse> {
  return requestRagApi<DeletionResponse>(documentPath(documentId), { method: 'DELETE' });
}

/** Every run of one document, newest first (up to rag's listing limit). */
export function listDocumentIngestionRuns(documentId: string, signal: AbortSignal): Promise<IngestionRun[]> {
  return requestRagApi<IngestionRun[]>('/ingestion-runs', {
    queryParameters: { documentId, status: 'all', limit: MAXIMUM_LISTED_INGESTION_RUNS },
    signal,
  });
}

export function listDocumentPages(documentId: string): Promise<DocumentPage[]> {
  return requestRagApi<DocumentPage[]>(`${documentPath(documentId)}/pages`);
}

export function getDocumentPage(documentId: string, pageNumber: number): Promise<DocumentPageDetail> {
  return requestRagApi<DocumentPageDetail>(`${documentPath(documentId)}/pages/${pageNumber}`);
}

export function listDocumentChunks(documentId: string, offset: number, limit: number): Promise<ChunkListResponse> {
  return requestRagApi<ChunkListResponse>(`${documentPath(documentId)}/chunks`, {
    queryParameters: { offset, limit },
  });
}

/** Multipart upload with byte progress; rag answers 409 `duplicate_document` and 415 for unsupported types. */
export function uploadDocument(file: File, onProgress: (progress: UploadProgress) => void): Promise<DocumentSummary> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadWithProgress<DocumentSummary>(ragBrowserUrls.documentUpload, formData, onProgress);
}
