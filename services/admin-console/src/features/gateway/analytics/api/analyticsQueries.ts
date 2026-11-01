import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { AnalyticsQueryParameters, AnalyticsTimeWindow, RecentRequestFilters } from './analyticsApi';
import { fetchAnalyticsOverview, fetchAnalyticsTimeseries, fetchRecentRequests, fetchTopErrors } from './analyticsApi';
import { analyticsQueryKeys } from './analyticsQueryKeys';

/** Enough error groups to total errors by HTTP status. */
const TOP_ERRORS_LIMIT = 200;

/** Analytics keep the previous result on screen while a new range loads (no layout jump). */
const keepFrameWhileRefetching = { placeholderData: keepPreviousData } as const;

export function useAnalyticsOverview(parameters: AnalyticsQueryParameters) {
  return useQuery({
    queryKey: analyticsQueryKeys.overview(parameters),
    queryFn: () => fetchAnalyticsOverview(parameters),
    ...keepFrameWhileRefetching,
  });
}

export function useAnalyticsTimeseries(parameters: AnalyticsQueryParameters, bucketSeconds?: number) {
  return useQuery({
    queryKey: analyticsQueryKeys.timeseries(parameters, bucketSeconds),
    queryFn: () => fetchAnalyticsTimeseries(parameters, bucketSeconds),
    ...keepFrameWhileRefetching,
  });
}

export function useTopErrors(timeWindow: AnalyticsTimeWindow) {
  return useQuery({
    queryKey: analyticsQueryKeys.topErrors(timeWindow),
    queryFn: () => fetchTopErrors(timeWindow, TOP_ERRORS_LIMIT),
    ...keepFrameWhileRefetching,
  });
}

export function useRecentRequests(filters: RecentRequestFilters, refetchIntervalMilliseconds: number | false) {
  return useQuery({
    queryKey: analyticsQueryKeys.recentRequests(filters),
    queryFn: () => fetchRecentRequests(filters),
    refetchInterval: refetchIntervalMilliseconds,
    ...keepFrameWhileRefetching,
  });
}
