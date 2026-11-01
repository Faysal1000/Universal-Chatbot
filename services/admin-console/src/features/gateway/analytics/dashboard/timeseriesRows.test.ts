import { describe, expect, it } from 'vitest';

import type { AnalyticsTimeseriesResponse, TimeseriesPoint } from '../api/analyticsTypes';
import { buildOutcomeChartData, enumerateBucketStarts } from './timeseriesRows';

const HOUR = 3_600_000;
const WINDOW_START = '2026-10-31T00:00:00Z';
const WINDOW_END = '2026-10-31T04:00:00Z';

function point(bucketStart: string, requestCount: number, errorCount: number) {
  return { bucket_start: bucketStart, request_count: requestCount, error_count: errorCount } as TimeseriesPoint;
}

describe('enumerateBucketStarts', () => {
  it('lists every bucket of the window, including empty ones', () => {
    const points = [point('2026-10-31T02:00:00Z', 3, 0)];
    const start = Date.parse(WINDOW_START);

    expect(enumerateBucketStarts(points, WINDOW_START, WINDOW_END, 3600)).toEqual([
      start,
      start + HOUR,
      start + 2 * HOUR,
      start + 3 * HOUR,
    ]);
  });

  it('aligns to the buckets the backend returned', () => {
    const observedBucketStart = '2026-10-31T01:30:00Z';

    const bucketStarts = enumerateBucketStarts([point(observedBucketStart, 1, 0)], WINDOW_START, WINDOW_END, 3600);

    expect(bucketStarts.map((bucketStart) => new Date(bucketStart).toISOString().slice(11, 16))).toEqual([
      '23:30',
      '00:30',
      '01:30',
      '02:30',
      '03:30',
    ]);
  });
});

describe('buildOutcomeChartData', () => {
  it('sums successes and errors per bucket and zero-fills the rest', () => {
    const response = {
      start: WINDOW_START,
      end: '2026-10-31T02:00:00Z',
      bucket_seconds: 3600,
      points: [point('2026-10-31T01:00:00Z', 5, 2), point('2026-10-31T01:00:00Z', 1, 0)],
    } as AnalyticsTimeseriesResponse;

    const { rows } = buildOutcomeChartData(response, { success: 'green', error: 'red' });

    expect(rows).toEqual([
      { bucketEpochMilliseconds: Date.parse(WINDOW_START), successes: 0, errors: 0 },
      { bucketEpochMilliseconds: Date.parse(WINDOW_START) + HOUR, successes: 4, errors: 2 },
    ]);
  });
});
