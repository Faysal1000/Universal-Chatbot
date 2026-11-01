import type { AuditEventFilters } from './auditTypes';

/** TanStack Query keys for the audit log. */
export const auditQueryKeys = {
  all: ['rag', 'audit-events'] as const,
  list: (filters: AuditEventFilters) => [...auditQueryKeys.all, filters] as const,
};
