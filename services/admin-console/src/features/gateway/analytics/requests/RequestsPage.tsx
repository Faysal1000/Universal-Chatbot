import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { joinClassNames } from '@/shared/lib/classNames';
import { RefreshButton } from '@/shared/ui/Button';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';

import { useProviders } from '../../providers/api/providerQueries';
import { useTaskRoutes } from '../../routing/api/routingQueries';
import { useRecentRequests } from '../api/analyticsQueries';
import type { RecentRequestEntry } from '../api/analyticsTypes';
import { RecentRequestsTable } from './RecentRequestsTable';
import { RequestDetailDialog } from './RequestDetailDialog';
import { RequestFiltersBar } from './RequestFiltersBar';
import { useRecentRequestFilters } from './useRecentRequestFilters';

const AUTO_REFRESH_INTERVAL_MILLISECONDS = 30_000;

export function RequestsPage() {
  const providersQuery = useProviders();
  const taskRoutesQuery = useTaskRoutes();
  const { filterState, updateFilters, hasActiveFilters, clearFilters, apiFilters } = useRecentRequestFilters();
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RecentRequestEntry | null>(null);
  const recentRequestsQuery = useRecentRequests(
    apiFilters,
    isAutoRefreshEnabled ? AUTO_REFRESH_INTERVAL_MILLISECONDS : false,
  );

  return (
    <>
      <PageHeader
        title="Requests"
        actions={
          <RefreshButton
            isRefreshing={recentRequestsQuery.isFetching}
            onRefresh={() => void recentRequestsQuery.refetch()}
          />
        }
      />

      <RequestFiltersBar
        filterState={filterState}
        onChange={updateFilters}
        hasActiveFilters={hasActiveFilters}
        onClear={clearFilters}
        providers={providersQuery.data ?? []}
        knownTaskNames={taskRoutesQuery.data?.map((route) => route.task_name) ?? []}
        isAutoRefreshEnabled={isAutoRefreshEnabled}
        onAutoRefreshChange={setIsAutoRefreshEnabled}
      />

      <Card bodyClassName="p-0">
        {recentRequestsQuery.isPending ? (
          <LoadingState label="Loading requests…" />
        ) : recentRequestsQuery.isError ? (
          <div className="p-4">
            <ErrorBanner
              title="Could not load requests"
              message={describeError(recentRequestsQuery.error)}
              onRetry={() => void recentRequestsQuery.refetch()}
            />
          </div>
        ) : recentRequestsQuery.data.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? 'No requests match these filters' : 'No requests recorded yet'}
            description={hasActiveFilters ? 'Try clearing a filter.' : undefined}
          />
        ) : (
          <div className={joinClassNames(recentRequestsQuery.isPlaceholderData && 'is-refetching')}>
            <RecentRequestsTable requests={recentRequestsQuery.data} onSelect={setSelectedRequest} />
          </div>
        )}
      </Card>

      <RequestDetailDialog request={selectedRequest} onClose={() => setSelectedRequest(null)} />
    </>
  );
}
