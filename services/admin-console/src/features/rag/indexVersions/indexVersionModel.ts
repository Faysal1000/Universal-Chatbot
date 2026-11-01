import type { PlacardState } from '@/shared/ui/StatePlacard';

import type { IndexVersion, IndexVersionStatus } from './api/indexVersionTypes';

const STATUS_PLACARDS: Record<IndexVersionStatus, { state: PlacardState; label: string }> = {
  live: { state: 'ready', label: 'Live' },
  building: { state: 'working', label: 'Building' },
  ready: { state: 'stopped', label: 'Ready, not live' },
  retired: { state: 'disabled', label: 'Retired' },
  failed: { state: 'failed', label: 'Failed' },
};

export function indexVersionPlacard(status: IndexVersionStatus): { state: PlacardState; label: string } {
  return STATUS_PLACARDS[status];
}

export interface IndexVersionActions {
  canBuild: boolean;
  canPromote: boolean;
  /** Why promotion is not offered yet, for a version that could otherwise be promoted. */
  promoteBlockedReason: string | null;
  canDelete: boolean;
}

/** Mirrors the service's rules in `index-versions-admin.service.ts`. */
export function indexVersionActions(
  version: Pick<IndexVersion, 'status' | 'missingDocumentCount'>,
): IndexVersionActions {
  const isPromotableStatus = version.status === 'ready' || version.status === 'retired';
  const isMissingDocuments = version.missingDocumentCount > 0;
  return {
    canBuild: version.status !== 'failed' && (version.status === 'building' || isMissingDocuments),
    canPromote: isPromotableStatus && !isMissingDocuments,
    promoteBlockedReason:
      isPromotableStatus && isMissingDocuments
        ? `Build it first: ${String(version.missingDocumentCount)} ready documents are not in it yet.`
        : null,
    canDelete: version.status !== 'live' && version.status !== 'building',
  };
}

export function findLiveVersion(versions: readonly IndexVersion[]): IndexVersion | undefined {
  return versions.find((version) => version.status === 'live');
}

/** Promoting a version older than the live one is a rollback. */
export function isRollback(
  candidate: Pick<IndexVersion, 'id'>,
  liveVersion: Pick<IndexVersion, 'id'> | undefined,
): boolean {
  return liveVersion !== undefined && candidate.id < liveVersion.id;
}

export function hasBuildInProgress(versions: readonly IndexVersion[]): boolean {
  return versions.some((version) => version.status === 'building');
}

export function describeEmbeddingModel(
  version: Pick<IndexVersion, 'embeddingModel' | 'embeddingModelRevision' | 'embeddingDimension'>,
): string {
  const revision = version.embeddingModelRevision ? `@${version.embeddingModelRevision.slice(0, 8)}` : '';
  return `${version.embeddingModel}${revision} (${String(version.embeddingDimension)} dims)`;
}
