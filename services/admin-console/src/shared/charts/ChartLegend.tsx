import { SeriesKey } from './SeriesKey';
import type { ChartSeries } from './chartTypes';

/** Legend above the plot; text uses text tokens, the colored key carries identity. */
export function ChartLegend({ series }: { series: readonly ChartSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary" aria-label="Legend">
      {series.map((seriesEntry) => (
        <li key={seriesEntry.dataKey} className="flex max-w-56 items-center gap-1.5">
          <SeriesKey color={seriesEntry.color} />
          <span className="truncate" title={seriesEntry.label}>
            {seriesEntry.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
