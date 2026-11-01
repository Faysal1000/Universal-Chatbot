/**
 * Turns the backend's sparse timeseries (buckets without traffic are omitted) into
 * dense chart rows: every bucket in the window is present and counts default to zero.
 */
import type { ChartData, ChartRow, ChartSeries } from '@/shared/charts/chartTypes';

import type { AnalyticsTimeseriesResponse, TimeseriesPoint } from '../api/analyticsTypes';

/** Safety valve so a tiny bucket over a huge range cannot create millions of rows. */
const MAXIMUM_BUCKET_COUNT = 5000;

/**
 * Every bucket start between `windowStart` and `windowEnd`, aligned to the buckets the
 * backend actually returned (whatever its alignment), so filled gaps never interleave.
 */
export function enumerateBucketStarts(
  points: readonly TimeseriesPoint[],
  windowStartIso: string,
  windowEndIso: string,
  bucketSeconds: number,
): number[] {
  const bucketMilliseconds = bucketSeconds * 1000;
  const windowStart = Date.parse(windowStartIso);
  const windowEnd = Date.parse(windowEndIso);
  const observedBucketStarts = new Set(points.map((point) => Date.parse(point.bucket_start)));
  if (bucketMilliseconds <= 0 || Number.isNaN(windowStart) || Number.isNaN(windowEnd)) {
    return [...observedBucketStarts].sort((first, second) => first - second);
  }

  const firstObservedBucketStart = Math.min(...observedBucketStarts);
  const alignmentAnchor = Number.isFinite(firstObservedBucketStart)
    ? firstObservedBucketStart
    : Math.floor(windowStart / bucketMilliseconds) * bucketMilliseconds;
  const bucketsBeforeAnchor = Math.floor((alignmentAnchor - windowStart) / bucketMilliseconds);
  let bucketStart = alignmentAnchor - bucketsBeforeAnchor * bucketMilliseconds;
  if (bucketStart > windowStart) bucketStart -= bucketMilliseconds;

  const bucketStarts = new Set<number>(observedBucketStarts);
  for (let bucketIndex = 0; bucketStart < windowEnd && bucketIndex < MAXIMUM_BUCKET_COUNT; bucketIndex += 1) {
    bucketStarts.add(bucketStart);
    bucketStart += bucketMilliseconds;
  }
  return [...bucketStarts].sort((first, second) => first - second);
}

function zeroFilledRowsByBucket(
  bucketStarts: readonly number[],
  series: readonly ChartSeries[],
): Map<number, ChartRow> {
  const rowsByBucket = new Map<number, ChartRow>();
  for (const bucketStart of bucketStarts) {
    const row: ChartRow = { bucketEpochMilliseconds: bucketStart };
    for (const seriesEntry of series) row[seriesEntry.dataKey] = 0;
    rowsByBucket.set(bucketStart, row);
  }
  return rowsByBucket;
}

/** Model calls per bucket split into successes and errors, summed over every group. */
export function buildOutcomeChartData(
  { points, start, end, bucket_seconds }: AnalyticsTimeseriesResponse,
  colors: { success: string; error: string },
): ChartData {
  const bucketStarts = enumerateBucketStarts(points, start, end, bucket_seconds);
  const series: ChartSeries[] = [
    { dataKey: 'successes', label: 'Success', color: colors.success },
    { dataKey: 'errors', label: 'Error', color: colors.error },
  ];
  const rowsByBucket = zeroFilledRowsByBucket(bucketStarts, series);
  for (const point of points) {
    const row = rowsByBucket.get(Date.parse(point.bucket_start));
    if (!row) continue;
    row.successes = (row.successes ?? 0) + point.request_count - point.error_count;
    row.errors = (row.errors ?? 0) + point.error_count;
  }
  return { rows: [...rowsByBucket.values()], series };
}
