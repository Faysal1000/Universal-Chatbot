import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { TimeSeriesChart } from '@/shared/charts/TimeSeriesChart';
import { joinClassNames } from '@/shared/lib/classNames';
import { formatCompactNumber, formatInteger } from '@/shared/lib/format';
import { RefreshButton } from '@/shared/ui/Button';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { ManifestStrip } from '@/shared/ui/ManifestStrip';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';

import { DocumentStatusTable } from './DocumentStatusTable';
import { WindowDaysSelector } from './WindowDaysSelector';
import { useRagOverview } from './api/overviewQueries';
import type { OverviewWindowDays, RagOverview } from './api/overviewTypes';
import { buildDailyTurnChartData, buildOverviewManifestFields, hasAnyTurns } from './overviewModel';

const DEFAULT_WINDOW_DAYS: OverviewWindowDays = 7;

export function RagOverviewPage() {
  const [windowDays, setWindowDays] = useState<OverviewWindowDays>(DEFAULT_WINDOW_DAYS);
  const overviewQuery = useRagOverview(windowDays);

  return (
    <>
      <PageHeader
        title="RAG overview"
        actions={
          <>
            <WindowDaysSelector selectedDays={windowDays} onChange={setWindowDays} />
            <RefreshButton isRefreshing={overviewQuery.isFetching} onRefresh={() => void overviewQuery.refetch()} />
          </>
        }
      />
      {overviewQuery.isPending ? (
        <LoadingState label="Loading the overview…" />
      ) : overviewQuery.isError ? (
        <ErrorBanner
          title="Could not load the RAG overview"
          message={describeError(overviewQuery.error)}
          onRetry={() => void overviewQuery.refetch()}
        />
      ) : (
        <div className={joinClassNames('flex flex-col gap-5', overviewQuery.isPlaceholderData && 'is-refetching')}>
          <OverviewContent overview={overviewQuery.data} />
        </div>
      )}
    </>
  );
}

function OverviewContent({ overview }: { overview: RagOverview }) {
  return (
    <>
      <ManifestStrip fields={buildOverviewManifestFields(overview)} />
      <Card title="Turns per day" description="UTC days">
        {hasAnyTurns(overview) ? (
          <DailyTurnsChart overview={overview} />
        ) : (
          <EmptyState title="No turns in this window" />
        )}
      </Card>
      <Card title="Documents" bodyClassName="p-0">
        <DocumentStatusTable documentCounts={overview.documents} />
      </Card>
    </>
  );
}

function DailyTurnsChart({ overview }: { overview: RagOverview }) {
  const chartData = buildDailyTurnChartData(overview);
  return (
    <TimeSeriesChart
      rows={chartData.rows}
      series={chartData.series}
      formatValue={(turnCount) => `${formatInteger(turnCount)} turns`}
      formatAxisTick={formatCompactNumber}
      accessibleDescription="Turns per day, split into answered, no-evidence fallback and failed"
      showTotalInTooltip
    />
  );
}
