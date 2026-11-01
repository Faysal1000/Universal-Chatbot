import { formatPercentFromFraction } from '@/shared/lib/format';

import type { AnalyticsGroupSummary, TopErrorEntry } from '../api/analyticsTypes';

const TOP_ITEM_COUNT = 6;

export interface RankedBarItem {
  label: string;
  value: number;
  /** Shown after the value, e.g. an error rate. */
  note?: string;
}

/** The busiest groups by request count, noting each one's error rate when it has errors. */
export function rankGroupsByRequests(groups: readonly AnalyticsGroupSummary[]): RankedBarItem[] {
  return [...groups]
    .sort((first, second) => second.request_count - first.request_count)
    .slice(0, TOP_ITEM_COUNT)
    .map((group) => ({
      label: group.group_key,
      value: group.request_count,
      note: group.error_count > 0 ? `${formatPercentFromFraction(group.error_rate)} errors` : undefined,
    }));
}

/** p90 latency per group, slowest first; groups without a measurement are left out. */
export function rankGroupsByLatency(groups: readonly AnalyticsGroupSummary[]): RankedBarItem[] {
  return groups
    .flatMap((group) =>
      group.latency_ms.p90 === null ? [] : [{ label: group.group_key, value: group.latency_ms.p90 }],
    )
    .sort((first, second) => second.value - first.value)
    .slice(0, TOP_ITEM_COUNT);
}

/** Error occurrences summed per HTTP status, most frequent first. */
export function countErrorsByStatus(topErrors: readonly TopErrorEntry[]): RankedBarItem[] {
  const countByStatus = new Map<number, number>();
  for (const error of topErrors) {
    countByStatus.set(error.http_status, (countByStatus.get(error.http_status) ?? 0) + error.occurrence_count);
  }
  return [...countByStatus.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, TOP_ITEM_COUNT)
    .map(([httpStatus, occurrenceCount]) => ({ label: `HTTP ${httpStatus}`, value: occurrenceCount }));
}
