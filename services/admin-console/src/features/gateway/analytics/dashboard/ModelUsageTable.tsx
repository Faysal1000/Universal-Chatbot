import {
  formatCompactNumber,
  formatDurationMilliseconds,
  formatInteger,
  formatPercentFromFraction,
  formatTokensPerSecond,
} from '@/shared/lib/format';
import { EmptyState } from '@/shared/ui/StatusMessages';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { AnalyticsGroupSummary } from '../api/analyticsTypes';

/** Every model called in the range, busiest first, with its volume, tokens and speed. */
export function ModelUsageTable({ models }: { models: readonly AnalyticsGroupSummary[] }) {
  if (models.length === 0) return <EmptyState title="No model calls" />;
  const busiestFirst = [...models].sort((first, second) => second.request_count - first.request_count);

  return (
    <Table caption="Usage by model">
      <thead>
        <tr>
          <HeaderCell>Model</HeaderCell>
          <HeaderCell isNumeric>Calls</HeaderCell>
          <HeaderCell isNumeric>Errors</HeaderCell>
          <HeaderCell isNumeric>Fallbacks</HeaderCell>
          <HeaderCell isNumeric>Tokens in</HeaderCell>
          <HeaderCell isNumeric>Tokens out</HeaderCell>
          <HeaderCell isNumeric>Latency p50</HeaderCell>
          <HeaderCell isNumeric>Latency p90</HeaderCell>
          <HeaderCell isNumeric>Latency p99</HeaderCell>
          <HeaderCell isNumeric>First token p50</HeaderCell>
          <HeaderCell isNumeric>Speed p50</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {busiestFirst.map((model) => (
          <tr key={model.group_key}>
            <DataCell className="font-mono text-xs whitespace-nowrap text-primary">{model.group_key}</DataCell>
            <DataCell isNumeric>{formatInteger(model.request_count)}</DataCell>
            <DataCell isNumeric className={model.error_count > 0 ? 'text-critical' : undefined}>
              {formatInteger(model.error_count)}
              {model.error_count > 0 ? ` (${formatPercentFromFraction(model.error_rate)})` : null}
            </DataCell>
            <DataCell isNumeric>{formatInteger(model.fallback_count)}</DataCell>
            <DataCell isNumeric>{formatCompactNumber(model.input_tokens)}</DataCell>
            <DataCell isNumeric>{formatCompactNumber(model.output_tokens)}</DataCell>
            <DataCell isNumeric>{formatDurationMilliseconds(model.latency_ms.p50)}</DataCell>
            <DataCell isNumeric>{formatDurationMilliseconds(model.latency_ms.p90)}</DataCell>
            <DataCell isNumeric>{formatDurationMilliseconds(model.latency_ms.p99)}</DataCell>
            <DataCell isNumeric>{formatDurationMilliseconds(model.time_to_first_token_ms.p50)}</DataCell>
            <DataCell isNumeric>{formatTokensPerSecond(model.output_tokens_per_second.p50)}</DataCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
