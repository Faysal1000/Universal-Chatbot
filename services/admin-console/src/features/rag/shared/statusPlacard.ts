import type { PlacardState } from '@/shared/ui/StatePlacard';

/** A state and its text label, ready for `<StatePlacard>`. */
export interface StatusPlacard {
  state: PlacardState;
  label: string;
}
