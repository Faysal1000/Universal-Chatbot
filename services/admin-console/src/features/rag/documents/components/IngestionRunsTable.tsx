import { formatDateTime, formatDurationMilliseconds, formatInteger } from '@/shared/lib/format';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { EmptyState } from '@/shared/ui/StatusMessages';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { IngestionRun } from '../api/documentTypes';
import { ingestionRunPlacard, ingestionStageLabel } from '../documentStatusModel';

/** The document's latest ingestion runs, newest first. */
export function IngestionRunsTable({ runs }: { runs: readonly IngestionRun[] }) {
  if (runs.length === 0) {
    return <EmptyState title="No ingestion runs yet" />;
  }
  return (
    <Table caption="Ingestion runs">
      <thead>
        <tr>
          <HeaderCell>Started</HeaderCell>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell>Stage</HeaderCell>
          <HeaderCell isNumeric>Progress</HeaderCell>
          <HeaderCell isNumeric>Pages parsed</HeaderCell>
          <HeaderCell isNumeric>Digital / scanned / hybrid</HeaderCell>
          <HeaderCell isNumeric>Vision calls</HeaderCell>
          <HeaderCell isNumeric>Duration</HeaderCell>
          <HeaderCell>Pipeline</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <IngestionRunRow key={run.id} run={run} />
        ))}
      </tbody>
    </Table>
  );
}

function IngestionRunRow({ run }: { run: IngestionRun }) {
  const placard = ingestionRunPlacard(run.status);
  return (
    <tr>
      <DataCell className="tabular whitespace-nowrap">{formatDateTime(run.startedAt ?? run.createdAt)}</DataCell>
      <DataCell>
        <StatePlacard state={placard.state} label={placard.label} />
        {run.failure ? (
          <p className="mt-0.5 max-w-72 text-xs text-critical-text">
            <span className="font-mono">{run.failure.code}</span>: {run.failure.message}
          </p>
        ) : null}
      </DataCell>
      <DataCell className="whitespace-nowrap">{ingestionStageLabel(run.stage)}</DataCell>
      <DataCell isNumeric>{run.progressPercent}%</DataCell>
      <DataCell isNumeric>
        {formatInteger(run.pages.parsed)} of {formatInteger(run.pages.total)}
      </DataCell>
      <DataCell isNumeric>
        {run.pages.digital} / {run.pages.scanned} / {run.pages.hybrid}
      </DataCell>
      <DataCell isNumeric>{formatInteger(run.visionModelCallCount)}</DataCell>
      <DataCell isNumeric>{formatDurationMilliseconds(runDurationMilliseconds(run))}</DataCell>
      <DataCell className="font-mono text-xs">{run.pipelineVersion}</DataCell>
    </tr>
  );
}

function runDurationMilliseconds(run: IngestionRun): number | null {
  if (run.startedAt === null || run.finishedAt === null) return null;
  return new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
}
