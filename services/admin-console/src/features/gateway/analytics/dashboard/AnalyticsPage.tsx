import { useIsFetching } from '@tanstack/react-query';
import { useState } from 'react';

import { TimeSeriesChart } from '@/shared/charts/TimeSeriesChart';
import { ERROR_STATUS_COLOR, categoricalSeriesColor } from '@/shared/charts/chartPalette';
import { describeError } from '@/shared/api/httpClient';
import { joinClassNames } from '@/shared/lib/classNames';
import {
  formatCompactNumber,
  formatDurationMilliseconds,
  formatInteger,
  formatPercentFromFraction,
} from '@/shared/lib/format';
import { resolveTimeWindow } from '@/shared/lib/timeRange';
import type { ResolvedTimeWindow, TimeRangePresetId } from '@/shared/lib/timeRange';
import { RefreshButton } from '@/shared/ui/Button';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { ManifestStrip } from '@/shared/ui/ManifestStrip';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';

import { useAnalyticsOverview, useAnalyticsTimeseries, useTopErrors } from '../api/analyticsQueries';
import { analyticsQueryKeys } from '../api/analyticsQueryKeys';
import type { AnalyticsOverviewResponse } from '../api/analyticsTypes';
import { RankedBars } from './RankedBars';
import { countErrorsByStatus, rankGroupsByLatency, rankGroupsByRequests } from './dashboardModel';
import { buildOutcomeChartData } from './timeseriesRows';

const RANGE_OPTIONS: { value: TimeRangePresetId; label: string }[] = [
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
];
/** 24–30 buckets per range, so bars stay readable on a phone. */
const BUCKET_SECONDS_BY_RANGE: Record<TimeRangePresetId, number> = {
  '24h': 3600,
  '7d': 6 * 3600,
  '30d': 24 * 3600,
};
const OUTCOME_COLORS = { success: 'var(--status-good)', error: ERROR_STATUS_COLOR };
/** Rankings are data ink, kept apart from the orange of actions; only error rankings use the error colour. */
const RANKING_COLOR = categoricalSeriesColor(0);

function resolvePresetWindow(presetId: TimeRangePresetId): ResolvedTimeWindow {
  return resolveTimeWindow(presetId, Date.now());
}

/** Gateway traffic at a glance: volume and outcome over time, the busiest models and tasks, errors, latency. */
export function AnalyticsPage() {
  const [presetId, setPresetId] = useState<TimeRangePresetId>('24h');
  const [timeWindow, setTimeWindow] = useState(() => resolvePresetWindow('24h'));
  const isRefreshing = useIsFetching({ queryKey: analyticsQueryKeys.all }) > 0;

  const modelOverviewQuery = useAnalyticsOverview({ ...timeWindow, group_by: 'model' });
  const taskOverviewQuery = useAnalyticsOverview({ ...timeWindow, group_by: 'task' });
  const timeseriesQuery = useAnalyticsTimeseries(
    { ...timeWindow, group_by: 'model' },
    BUCKET_SECONDS_BY_RANGE[presetId],
  );
  const topErrorsQuery = useTopErrors(timeWindow);

  const selectRange = (nextPresetId: TimeRangePresetId) => {
    setPresetId(nextPresetId);
    setTimeWindow(resolvePresetWindow(nextPresetId));
  };
  const modelOverview = modelOverviewQuery.data;

  return (
    <>
      <PageHeader
        title="Analytics"
        actions={
          <>
            <SegmentedControl label="Range" options={RANGE_OPTIONS} value={presetId} onChange={selectRange} />
            <RefreshButton isRefreshing={isRefreshing} onRefresh={() => setTimeWindow(resolvePresetWindow(presetId))} />
          </>
        }
      />

      {modelOverviewQuery.isError ? (
        <ErrorBanner
          title="Could not load analytics"
          message={describeError(modelOverviewQuery.error)}
          onRetry={() => void modelOverviewQuery.refetch()}
        />
      ) : modelOverview === undefined ? (
        <LoadingState label="Loading analytics…" />
      ) : modelOverview.totals.request_count === 0 ? (
        <Card>
          <EmptyState title="No requests in this range" description="Pick a longer range or send some traffic." />
        </Card>
      ) : (
        <div className={joinClassNames('flex flex-col gap-4', modelOverviewQuery.isPlaceholderData && 'is-refetching')}>
          <ManifestStrip fields={buildHeadlineFields(modelOverview)} />

          <Card title="Model calls">
            {timeseriesQuery.isError ? (
              <ErrorBanner
                message={describeError(timeseriesQuery.error)}
                onRetry={() => void timeseriesQuery.refetch()}
              />
            ) : timeseriesQuery.data ? (
              <TimeSeriesChart
                {...buildOutcomeChartData(timeseriesQuery.data, OUTCOME_COLORS)}
                formatValue={formatInteger}
                formatAxisTick={formatCompactNumber}
                showTotalInTooltip
                height={260}
                accessibleDescription="Stacked bar chart of successful and failed model calls over time."
              />
            ) : (
              <LoadingState />
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
            <Card title="Top models">
              <RankedBars
                items={rankGroupsByRequests(modelOverview.groups)}
                formatValue={formatInteger}
                color={RANKING_COLOR}
                emptyTitle="No model calls"
              />
            </Card>
            <Card title="Top tasks">
              {taskOverviewQuery.isError ? (
                <ErrorBanner
                  message={describeError(taskOverviewQuery.error)}
                  onRetry={() => void taskOverviewQuery.refetch()}
                />
              ) : taskOverviewQuery.data ? (
                <RankedBars
                  items={rankGroupsByRequests(taskOverviewQuery.data.groups)}
                  formatValue={formatInteger}
                  color={RANKING_COLOR}
                  emptyTitle="No tasks called"
                />
              ) : (
                <LoadingState />
              )}
            </Card>
            <Card title="Errors by status">
              {topErrorsQuery.isError ? (
                <ErrorBanner
                  message={describeError(topErrorsQuery.error)}
                  onRetry={() => void topErrorsQuery.refetch()}
                />
              ) : topErrorsQuery.data ? (
                <RankedBars
                  items={countErrorsByStatus(topErrorsQuery.data)}
                  formatValue={formatInteger}
                  color={ERROR_STATUS_COLOR}
                  emptyTitle="No errors"
                />
              ) : (
                <LoadingState />
              )}
            </Card>
            <Card title="Latency p90" description="By model">
              <RankedBars
                items={rankGroupsByLatency(modelOverview.groups)}
                formatValue={formatDurationMilliseconds}
                color={RANKING_COLOR}
                emptyTitle="No latency measured"
              />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function buildHeadlineFields({ totals, unique_request_count }: AnalyticsOverviewResponse) {
  return [
    {
      label: 'Model calls',
      value: formatInteger(totals.request_count),
      note:
        unique_request_count === totals.request_count ? undefined : `${formatInteger(unique_request_count)} requests`,
    },
    { label: 'Success rate', value: formatPercentFromFraction(1 - totals.error_rate) },
    { label: 'Errors', value: formatInteger(totals.error_count) },
    {
      label: 'Latency p90',
      value: formatDurationMilliseconds(totals.latency_ms.p90),
      note: `p99 ${formatDurationMilliseconds(totals.latency_ms.p99)}`,
    },
    { label: 'Tokens', value: formatCompactNumber(totals.input_tokens + totals.output_tokens) },
  ];
}
