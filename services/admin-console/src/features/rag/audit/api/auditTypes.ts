import type { operations } from '@/contracts/rag';

export type AuditEventPage = operations['AuditAdminController_list']['responses'][200]['content']['application/json'];
export type AuditEvent = AuditEventPage['items'][number];

/** Filters `GET /audit-events` supports; empty strings mean "not filtered". */
export interface AuditEventFilters {
  action: string;
  targetType: string;
  targetId: string;
}

export const AUDIT_EVENT_PAGE_SIZE = 50;
