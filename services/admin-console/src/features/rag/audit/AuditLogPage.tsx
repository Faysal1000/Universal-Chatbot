import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { joinClassNames } from '@/shared/lib/classNames';
import { Button, RefreshButton } from '@/shared/ui/Button';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';

import { useAuditEventPages } from './api/auditQueries';
import type { AuditEventFilters } from './api/auditTypes';
import { EMPTY_AUDIT_FILTERS, hasActiveAuditFilters } from './auditModel';
import { AuditEventsTable } from './components/AuditEventsTable';
import { AuditFiltersBar } from './components/AuditFiltersBar';

export function AuditLogPage() {
  const [filters, setFilters] = useState<AuditEventFilters>(EMPTY_AUDIT_FILTERS);
  const auditPagesQuery = useAuditEventPages(filters);
  const events = auditPagesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const isFiltered = hasActiveAuditFilters(filters);

  return (
    <>
      <PageHeader
        title="Audit log"
        actions={
          <RefreshButton
            isRefreshing={auditPagesQuery.isFetching && !auditPagesQuery.isFetchingNextPage}
            onRefresh={() => void auditPagesQuery.refetch()}
          />
        }
      />
      <AuditFiltersBar appliedFilters={filters} onApply={setFilters} />
      <Card bodyClassName="p-0">
        {auditPagesQuery.isPending ? (
          <LoadingState label="Loading the audit log…" />
        ) : auditPagesQuery.isError ? (
          <div className="p-4">
            <ErrorBanner
              title="Could not load the audit log"
              message={describeError(auditPagesQuery.error)}
              onRetry={() => void auditPagesQuery.refetch()}
            />
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            title={isFiltered ? 'No events match these filters' : 'Nothing recorded yet'}
            description={isFiltered ? 'Target ids must match exactly.' : undefined}
          />
        ) : (
          <div className={joinClassNames(auditPagesQuery.isPlaceholderData && 'is-refetching')}>
            <AuditEventsTable events={events} />
            {auditPagesQuery.hasNextPage ? (
              <div className="flex justify-center border-t border-border p-3">
                <Button
                  isLoading={auditPagesQuery.isFetchingNextPage}
                  onClick={() => void auditPagesQuery.fetchNextPage()}
                >
                  Load older events
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </>
  );
}
