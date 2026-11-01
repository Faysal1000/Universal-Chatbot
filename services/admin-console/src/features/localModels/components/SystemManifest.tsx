import type { UseQueryResult } from '@tanstack/react-query';

import { describeError } from '@/shared/api/httpClient';
import { ManifestStrip } from '@/shared/ui/ManifestStrip';
import { LoadingState } from '@/shared/ui/Spinner';
import { ErrorBanner } from '@/shared/ui/StatusMessages';

import type { SystemView } from '../api/localModelTypes';
import { systemManifestFields } from '../systemManifestModel';

/** Host resources and memory budgets of local-llm, as a manifest line. */
export function SystemManifest({ systemQuery }: { systemQuery: UseQueryResult<SystemView> }) {
  if (systemQuery.isPending) return <LoadingState label="Reading host resources…" />;
  if (systemQuery.isError) {
    return (
      <ErrorBanner
        title="Host resources unavailable"
        message={describeError(systemQuery.error)}
        onRetry={() => void systemQuery.refetch()}
      />
    );
  }
  return <ManifestStrip fields={systemManifestFields(systemQuery.data)} />;
}
