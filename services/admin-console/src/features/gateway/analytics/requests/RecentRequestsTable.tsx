import { formatDurationMilliseconds, formatInteger, formatShortDateTime } from '@/shared/lib/format';
import { StatusBadge } from '@/shared/ui/StatusMessages';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { RecentRequestEntry } from '../api/analyticsTypes';

/** The request log; clicking a row (or its request ID) opens the detail dialog. Phones get two lines per row. */
export function RecentRequestsTable({
  requests,
  onSelect,
}: {
  requests: readonly RecentRequestEntry[];
  onSelect: (request: RecentRequestEntry) => void;
}) {
  return (
    <Table caption="Recent requests" isStackedOnMobile>
      <thead>
        <tr>
          <HeaderCell>Time</HeaderCell>
          <HeaderCell>Request ID</HeaderCell>
          <HeaderCell>Task</HeaderCell>
          <HeaderCell>Model</HeaderCell>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell isNumeric>Tokens in / out</HeaderCell>
          <HeaderCell isNumeric>Duration</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {requests.map((request, rowIndex) => {
          const isSuccess = request.error_class === null && request.http_status < 400;
          return (
            <tr
              // A request id can repeat across attempts, so the index keeps keys unique.
              key={`${request.request_id}-${request.started_at}-${rowIndex}`}
              onClick={() => onSelect(request)}
              className="cursor-pointer hover:bg-surface-hover"
            >
              <DataCell className="whitespace-nowrap max-sm:order-1">
                {formatShortDateTime(request.started_at)}
              </DataCell>
              <DataCell className="max-sm:hidden">
                <button
                  type="button"
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    onSelect(request);
                  }}
                  className="max-w-36 truncate rounded font-mono text-xs text-primary hover:text-accent hover:underline"
                  title={`Show details for ${request.request_id}`}
                >
                  {request.request_id}
                </button>
              </DataCell>
              <DataCell className="font-mono text-xs text-primary max-sm:order-4 max-sm:basis-full">
                {request.task_name}
                <span className="text-secondary sm:hidden">
                  {' · '}
                  {request.provider_id}/{request.model_id}
                </span>
              </DataCell>
              <DataCell className="font-mono text-xs whitespace-nowrap max-sm:hidden">
                {request.provider_id}/{request.model_id}
              </DataCell>
              <DataCell className="whitespace-nowrap max-sm:order-2">
                <span className="inline-flex items-center gap-2">
                  <StatusBadge tone={isSuccess ? 'good' : 'critical'} label={String(request.http_status)} />
                  {request.is_fallback ? <StatusBadge tone="warning" label="Fallback" /> : null}
                </span>
              </DataCell>
              <DataCell isNumeric className="max-sm:hidden">
                {formatInteger(request.input_tokens)} / {formatInteger(request.output_tokens)}
              </DataCell>
              <DataCell isNumeric className="max-sm:order-3 max-sm:ml-auto">
                {formatDurationMilliseconds(request.total_duration_ms)}
              </DataCell>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
