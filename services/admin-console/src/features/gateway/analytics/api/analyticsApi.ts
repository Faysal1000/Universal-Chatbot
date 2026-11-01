import { requestGatewayApi } from '@/shared/api/httpClient';
import type { IsoDateTimeString } from '@/shared/api/types';

import type {
  AnalyticsGroupBy,
  AnalyticsOverviewResponse,
  AnalyticsTimeseriesResponse,
  RecentRequestEntry,
  TopErrorEntry,
} from './analyticsTypes';

/** The time window and grouping shared by every analytics query. */
export interface AnalyticsQueryParameters {
  start: IsoDateTimeString;
  end: IsoDateTimeString;
  group_by: AnalyticsGroupBy;
}

export interface RecentRequestFilters {
  start?: IsoDateTimeString;
  end?: IsoDateTimeString;
  limit?: number;
  errors_only?: boolean;
  task_name?: string;
  provider_id?: string;
  model_id?: string;
}

export function fetchAnalyticsOverview(parameters: AnalyticsQueryParameters): Promise<AnalyticsOverviewResponse> {
  return requestGatewayApi<AnalyticsOverviewResponse>('/analytics/overview', { queryParameters: { ...parameters } });
}

export type AnalyticsTimeWindow = Pick<AnalyticsQueryParameters, 'start' | 'end'>;

export function fetchAnalyticsTimeseries(
  parameters: AnalyticsQueryParameters,
  bucketSeconds?: number,
): Promise<AnalyticsTimeseriesResponse> {
  return requestGatewayApi<AnalyticsTimeseriesResponse>('/analytics/timeseries', {
    queryParameters: { ...parameters, bucket_seconds: bucketSeconds },
  });
}

export function fetchTopErrors(parameters: AnalyticsTimeWindow, limit?: number): Promise<TopErrorEntry[]> {
  return requestGatewayApi<TopErrorEntry[]>('/analytics/errors', {
    queryParameters: { start: parameters.start, end: parameters.end, limit },
  });
}

export function fetchRecentRequests(filters: RecentRequestFilters): Promise<RecentRequestEntry[]> {
  return requestGatewayApi<RecentRequestEntry[]>('/analytics/requests', {
    queryParameters: { ...filters, errors_only: filters.errors_only ? true : undefined },
  });
}
