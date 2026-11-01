import { requestRagApi } from '@/shared/api/httpClient';

import { AUDIT_EVENT_PAGE_SIZE } from './auditTypes';
import type { AuditEventFilters, AuditEventPage } from './auditTypes';

export function listAuditEvents(
  filters: AuditEventFilters,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<AuditEventPage> {
  return requestRagApi<AuditEventPage>('/audit-events', {
    queryParameters: {
      action: filters.action,
      targetType: filters.targetType,
      targetId: filters.targetId.trim(),
      cursor,
      limit: AUDIT_EVENT_PAGE_SIZE,
    },
    signal,
  });
}
