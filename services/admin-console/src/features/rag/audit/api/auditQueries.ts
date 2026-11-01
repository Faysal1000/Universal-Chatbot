import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';

import { listAuditEvents } from './auditApi';
import { auditQueryKeys } from './auditQueryKeys';
import type { AuditEventFilters, AuditEventPage } from './auditTypes';

export function useAuditEventPages(filters: AuditEventFilters) {
  return useInfiniteQuery({
    queryKey: auditQueryKeys.list(filters),
    queryFn: ({ pageParam, signal }) => listAuditEvents(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: AuditEventPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}
