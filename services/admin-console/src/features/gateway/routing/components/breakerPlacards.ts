import type { PlacardState } from '@/shared/ui/StatePlacard';

import type { BreakerStatusName } from '../api/routingTypes';

/** Breaker states in the console's state vocabulary: closed = ready, half-open = working (on trial), open = failed. */
export const BREAKER_PLACARDS: Record<BreakerStatusName, { state: PlacardState; label: string }> = {
  closed: { state: 'ready', label: 'Closed' },
  half_open: { state: 'working', label: 'Half-open, next call is a trial' },
  open: { state: 'failed', label: 'Open, skipped' },
};
