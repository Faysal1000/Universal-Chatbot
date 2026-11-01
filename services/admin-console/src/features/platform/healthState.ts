import type { PlacardState } from '@/shared/ui/StatePlacard';

import type { HealthStatus } from './api/platformTypes';

export const HEALTH_PLACARD: Record<HealthStatus, { state: PlacardState; label: string }> = {
  ready: { state: 'ready', label: 'Ready' },
  not_ready: { state: 'warning', label: 'Not ready' },
  unreachable: { state: 'failed', label: 'Unreachable' },
  not_configured: { state: 'stopped', label: 'Not configured' },
};

/** Services word a healthy dependency differently (`up` from rag, `ok` from document-parser). */
const HEALTHY_DEPENDENCY_STATUSES = new Set(['up', 'ok', 'ready', 'healthy']);

export function dependencyPlacardState(status: string): PlacardState {
  return HEALTHY_DEPENDENCY_STATUSES.has(status.toLowerCase()) ? 'ready' : 'failed';
}
