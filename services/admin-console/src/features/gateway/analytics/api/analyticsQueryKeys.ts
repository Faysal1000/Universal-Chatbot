import type { AnalyticsQueryParameters, AnalyticsTimeWindow, RecentRequestFilters } from './analyticsApi';

/** TanStack Query keys for analytics; everything sits under `all` so one call refreshes the analytics page. */
export const analyticsQueryKeys = {
  all: ['analytics'] as const,
  overview: (parameters: AnalyticsQueryParameters) => ['analytics', 'overview', parameters] as const,
  timeseries: (parameters: AnalyticsQueryParameters, bucketSeconds: number | undefined) =>
    ['analytics', 'timeseries', parameters, bucketSeconds] as const,
  topErrors: (timeWindow: AnalyticsTimeWindow) => ['analytics', 'errors', timeWindow] as const,
  recentRequests: (filters: RecentRequestFilters) => ['analytics', 'requests', filters] as const,
};
