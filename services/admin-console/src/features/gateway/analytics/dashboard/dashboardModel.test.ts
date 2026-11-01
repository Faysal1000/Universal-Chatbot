import { describe, expect, it } from 'vitest';

import type { AnalyticsGroupSummary, TopErrorEntry } from '../api/analyticsTypes';
import { countErrorsByStatus, rankGroupsByLatency, rankGroupsByRequests } from './dashboardModel';

function group(groupKey: string, requestCount: number, errorCount: number, p90Milliseconds: number | null) {
  return {
    group_key: groupKey,
    request_count: requestCount,
    error_count: errorCount,
    error_rate: requestCount === 0 ? 0 : errorCount / requestCount,
    latency_ms: { p50: null, p90: p90Milliseconds, p99: null },
  } as AnalyticsGroupSummary;
}

function error(httpStatus: number, occurrenceCount: number) {
  return { http_status: httpStatus, occurrence_count: occurrenceCount } as TopErrorEntry;
}

describe('dashboard model', () => {
  it('ranks groups by requests and notes error rates', () => {
    const items = rankGroupsByRequests([group('a', 5, 0, 10), group('b', 20, 5, 10)]);

    expect(items.map((item) => item.label)).toEqual(['b', 'a']);
    expect(items[0]?.note).toBe('25.0% errors');
    expect(items[1]?.note).toBeUndefined();
  });

  it('ranks the slowest groups first and skips unmeasured ones', () => {
    const items = rankGroupsByLatency([group('fast', 1, 0, 100), group('none', 1, 0, null), group('slow', 1, 0, 900)]);

    expect(items.map((item) => item.label)).toEqual(['slow', 'fast']);
  });

  it('sums errors per HTTP status', () => {
    const items = countErrorsByStatus([error(500, 2), error(429, 7), error(500, 3)]);

    expect(items).toEqual([
      { label: 'HTTP 429', value: 7 },
      { label: 'HTTP 500', value: 5 },
    ]);
  });
});
