import { requestRagApi } from '@/shared/api/httpClient';

import type { IndexVersion } from './indexVersionTypes';

export function listIndexVersions(): Promise<IndexVersion[]> {
  return requestRagApi<IndexVersion[]>('/index-versions');
}

/** Starts building a new version with the embedding model and chunker in use now. */
export function createIndexVersion(): Promise<IndexVersion> {
  return requestRagApi<IndexVersion>('/index-versions', { method: 'POST' });
}

/** Builds a version further, or catches it up with documents added since. */
export function buildIndexVersion(indexVersionId: number): Promise<IndexVersion> {
  return requestRagApi<IndexVersion>(`/index-versions/${String(indexVersionId)}/build`, { method: 'POST' });
}

export function promoteIndexVersion(indexVersionId: number): Promise<IndexVersion> {
  return requestRagApi<IndexVersion>(`/index-versions/${String(indexVersionId)}/promote`, { method: 'POST' });
}

export function deleteIndexVersion(indexVersionId: number): Promise<void> {
  return requestRagApi<undefined>(`/index-versions/${String(indexVersionId)}`, { method: 'DELETE' });
}
