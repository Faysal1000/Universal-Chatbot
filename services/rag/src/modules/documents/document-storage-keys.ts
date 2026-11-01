/**
 * Object key layout in the service bucket. The parser contract fixes the run prefix
 * pattern (`documents/{id}/runs/{runId}/`), so changing it is a contract change.
 */
export const documentStorageKeys = {
  staging: (uploadId: string) => `staging/${uploadId}`,
  original: (sha256: string) => `originals/${sha256}`,
  documentPrefix: (documentId: string) => `documents/${documentId}/`,
  runPrefix: (documentId: string, ingestionRunId: string) =>
    `documents/${documentId}/runs/${ingestionRunId}/`,
  attachment: (attachmentId: string) => `attachments/${attachmentId}`,
} as const;
