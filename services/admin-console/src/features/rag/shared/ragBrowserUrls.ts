/**
 * Same-origin URLs the browser loads directly (images, downloads, event streams, uploads)
 * instead of through `requestRagApi`. The BFF maps `/api/rag/...` to rag's `/v1/admin/...`.
 */
import { API_BASE_PATHS } from '@/shared/api/httpClient';

const encode = encodeURIComponent;

function documentUrl(documentId: string): string {
  return `${API_BASE_PATHS.rag}/documents/${encode(documentId)}`;
}

export const ragBrowserUrls = {
  documentUpload: `${API_BASE_PATHS.rag}/documents`,
  documentEvents: (documentId: string) => `${documentUrl(documentId)}/events`,
  documentDownload: (documentId: string) => `${documentUrl(documentId)}/download`,
  pageImage: (documentId: string, pageNumber: number) => `${documentUrl(documentId)}/pages/${pageNumber}/image`,
  blockCrop: (documentId: string, blockId: string) => `${documentUrl(documentId)}/blocks/${encode(blockId)}/crop`,
};
