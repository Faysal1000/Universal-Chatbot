import { ROUTE_PATHS, documentPath } from '@/shared/routePaths';

import type { AuditEvent, AuditEventFilters } from './api/auditTypes';

export const EMPTY_AUDIT_FILTERS: AuditEventFilters = { action: '', targetType: '', targetId: '' };

export function hasActiveAuditFilters(filters: AuditEventFilters): boolean {
  return filters.action !== '' || filters.targetType !== '' || filters.targetId.trim() !== '';
}

/** Every action the rag service writes to its audit log. */
export const KNOWN_AUDIT_ACTIONS = [
  'admin.logged_in',
  'admin.login_failed',
  'chatbot_settings.saved',
  'chatbot_settings.activated',
  'client_block.created',
  'client_block.deleted',
  'dead_letter.retried',
  'dead_letter.discarded',
  'document.uploaded',
  'document.updated',
  'document.enabled',
  'document.disabled',
  'document.reprocessed',
  'document.deleted',
  'index_version.created',
  'index_version.promoted',
  'index_version.deleted',
  'widget_key.created',
  'widget_key.updated',
  'widget_key.revoked',
] as const;

export const KNOWN_AUDIT_TARGET_TYPES = [
  'admin_user',
  'chatbot_settings',
  'client_block',
  'dead_letter',
  'document',
  'index_version',
  'widget_key',
] as const;

function humaniseIdentifier(identifier: string): string {
  const words = identifier.replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "index_version.promoted" → "Index version promoted". */
export function describeAuditAction(action: string): string {
  return humaniseIdentifier(action);
}

/** "client_block" → "Client block". */
export function describeTargetType(targetType: string): string {
  return humaniseIdentifier(targetType);
}

/**
 * The admin's username when rag recorded one (the console names its signed-in admin), else a
 * short admin id, else the API key with no named admin.
 */
export function describeActor(event: Pick<AuditEvent, 'actorUsername' | 'actorAdminUserId'>): string {
  if (event.actorUsername) return event.actorUsername;
  if (event.actorAdminUserId === null) return 'API key or deleted admin';
  return `Admin ${event.actorAdminUserId.split('-')[0] ?? event.actorAdminUserId}`;
}

/** Where the console shows the target, when it has a page for it. */
export function auditTargetPath(event: Pick<AuditEvent, 'action' | 'targetType' | 'targetId'>): string | null {
  if (event.targetId === null) return null;
  switch (event.targetType) {
    case 'document':
      return event.action === 'document.deleted' ? null : documentPath(event.targetId);
    case 'index_version':
      return ROUTE_PATHS.ragIndexVersions;
    case 'client_block':
      return ROUTE_PATHS.ragClientBlocks;
    case 'chatbot_settings':
      return ROUTE_PATHS.ragSettings;
    case 'dead_letter':
      return ROUTE_PATHS.ragQueues;
    case 'widget_key':
      return ROUTE_PATHS.ragWebsiteWidgets;
    default:
      return null;
  }
}

/** One line of the event's details: "embeddingModel: x, chunkerVersion: y". */
export function summariseAuditDetails(details: AuditEvent['details']): string {
  const entries = Object.entries(details);
  if (entries.length === 0) return 'No details';
  return entries
    .map(([key, value]) => `${key}: ${typeof value === 'object' && value !== null ? '{…}' : String(value)}`)
    .join(', ');
}
