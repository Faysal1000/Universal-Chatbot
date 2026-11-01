/**
 * Chart colors, referenced as CSS custom properties defined in `index.css`
 * (each has a light and a dark step validated against its surface).
 * Categorical slots are assigned in this fixed order, never cycled.
 */
const CATEGORICAL_SERIES_COLORS = [
  'var(--chart-series-1)',
  'var(--chart-series-2)',
  'var(--chart-series-3)',
  'var(--chart-series-4)',
  'var(--chart-series-5)',
] as const;

/** Status color reserved for errors; never used for an ordinary series. */
export const ERROR_STATUS_COLOR = 'var(--status-critical)';

/** The series colour for a slot; slots past the palette share a neutral. */
export function categoricalSeriesColor(slotIndex: number): string {
  return CATEGORICAL_SERIES_COLORS[slotIndex] ?? 'var(--chart-series-other)';
}
