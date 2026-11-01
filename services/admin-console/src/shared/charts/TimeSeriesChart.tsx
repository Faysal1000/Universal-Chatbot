import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';

import { formatBucketHeading, formatTimeAxisTick } from '../lib/format';
import { ChartLegend } from './ChartLegend';
import { SeriesKey } from './SeriesKey';
import type { ChartRow, ChartSeries } from './chartTypes';

export interface TimeSeriesChartProps {
  rows: readonly ChartRow[];
  series: readonly ChartSeries[];
  /** Formats values in the tooltip (full precision). */
  formatValue: (value: number) => string;
  /** Formats y-axis ticks (compact). */
  formatAxisTick: (value: number) => string;
  /** Accessible summary of what is plotted, e.g. "Requests per bucket by model". */
  accessibleDescription: string;
  showTotalInTooltip?: boolean;
  height?: number;
}

const AXIS_TICK_STYLE = { fill: 'var(--text-muted)', fontSize: 11 } as const;
const MAXIMUM_BAR_THICKNESS = 24;

/**
 * Time-bucketed stacked bars following the dashboard's chart rules: one y-axis, hairline
 * horizontal grid, bars capped at 24px with rounded data ends and a 2px surface gap
 * between stacked segments, a legend for two or more series, and a
 * crosshair tooltip listing every series at the hovered bucket.
 */
export function TimeSeriesChart({
  rows,
  series,
  formatValue,
  formatAxisTick,
  accessibleDescription,
  showTotalInTooltip = false,
  height = 220,
}: TimeSeriesChartProps) {
  const firstBucket = rows[0]?.bucketEpochMilliseconds ?? 0;
  const lastBucket = rows[rows.length - 1]?.bucketEpochMilliseconds ?? 0;
  const rangeSpanMilliseconds = lastBucket - firstBucket;
  const rowsByBucket = new Map(rows.map((row) => [row.bucketEpochMilliseconds, row]));

  const renderTooltip = (tooltipProps: TooltipContentProps) => {
    if (!tooltipProps.active || tooltipProps.label === undefined) return null;
    const hoveredRow = rowsByBucket.get(Number(tooltipProps.label));
    if (!hoveredRow) return null;
    return (
      <ChartTooltipContent row={hoveredRow} series={series} formatValue={formatValue} showTotal={showTotalInTooltip} />
    );
  };

  const commonAxes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
      <XAxis
        dataKey="bucketEpochMilliseconds"
        type="category"
        tickFormatter={(bucketStart: number) => formatTimeAxisTick(bucketStart, rangeSpanMilliseconds)}
        tick={AXIS_TICK_STYLE}
        tickLine={false}
        axisLine={{ stroke: 'var(--chart-axis)' }}
        minTickGap={40}
        interval="preserveStartEnd"
      />
      <YAxis
        tickFormatter={formatAxisTick}
        tick={AXIS_TICK_STYLE}
        tickLine={false}
        axisLine={false}
        width={56}
        allowDecimals={false}
      />
    </>
  );

  return (
    <figure className="flex flex-col gap-2">
      {series.length >= 2 ? <ChartLegend series={series} /> : null}
      <div role="img" aria-label={accessibleDescription} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[...rows]} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="20%">
            {commonAxes}
            <Tooltip content={renderTooltip} cursor={{ fill: 'var(--surface-hover)' }} isAnimationActive={false} />
            {series.map((seriesEntry, seriesIndex) => (
              <Bar
                key={seriesEntry.dataKey}
                dataKey={seriesEntry.dataKey}
                name={seriesEntry.label}
                stackId="stack"
                fill={seriesEntry.color}
                stroke="var(--surface)"
                strokeWidth={series.length > 1 ? 2 : 0}
                maxBarSize={MAXIMUM_BAR_THICKNESS}
                radius={seriesIndex === series.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

interface ChartTooltipContentProps {
  row: ChartRow;
  series: readonly ChartSeries[];
  formatValue: (value: number) => string;
  showTotal: boolean;
}

/** Values lead (strong), series names follow (secondary); a colored key carries identity. */
function ChartTooltipContent({ row, series, formatValue, showTotal }: ChartTooltipContentProps) {
  const total = series.reduce((runningTotal, seriesEntry) => runningTotal + (row[seriesEntry.dataKey] ?? 0), 0);
  return (
    <div className="min-w-44 rounded border border-border-strong bg-surface-raised px-3 py-2 text-xs shadow-xl">
      <p className="mb-1.5 text-muted">{formatBucketHeading(row.bucketEpochMilliseconds)}</p>
      <ul className="flex flex-col gap-1">
        {[...series].reverse().map((seriesEntry) => {
          const value = row[seriesEntry.dataKey];
          return (
            <li key={seriesEntry.dataKey} className="flex items-center gap-2">
              <SeriesKey color={seriesEntry.color} />
              <span className="font-semibold text-primary tabular-nums">
                {value === null || value === undefined ? 'No data' : formatValue(value)}
              </span>
              <span className="truncate text-secondary">{seriesEntry.label}</span>
            </li>
          );
        })}
      </ul>
      {showTotal && series.length > 1 ? (
        <p className="mt-1.5 border-t border-border pt-1.5 text-secondary">
          <span className="font-semibold text-primary tabular-nums">{formatValue(total)}</span> total
        </p>
      ) : null}
    </div>
  );
}
