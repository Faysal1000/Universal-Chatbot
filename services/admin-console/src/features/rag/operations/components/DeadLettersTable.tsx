import { RotateCcw, Trash2 } from 'lucide-react';

import { formatInteger, formatShortDateTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { DeadLetter } from '../api/operationsTypes';
import { summarisePayload } from '../operationsModel';

export interface DeadLettersTableProps {
  deadLetters: readonly DeadLetter[];
  retryingDeadLetterId: string | null;
  onRetry: (deadLetter: DeadLetter) => void;
  onDiscard: (deadLetter: DeadLetter) => void;
}

export function DeadLettersTable({ deadLetters, retryingDeadLetterId, onRetry, onDiscard }: DeadLettersTableProps) {
  return (
    <Table caption="Jobs that used up their retries">
      <thead>
        <tr>
          <HeaderCell>Job</HeaderCell>
          <HeaderCell>Error</HeaderCell>
          <HeaderCell isNumeric>Attempts</HeaderCell>
          <HeaderCell>Failed</HeaderCell>
          <HeaderCell>Payload</HeaderCell>
          <HeaderCell>
            <span className="sr-only">Actions</span>
          </HeaderCell>
        </tr>
      </thead>
      <tbody>
        {deadLetters.map((deadLetter) => (
          <tr key={deadLetter.id} className="align-top">
            <DataCell>
              <p className="font-medium text-primary">{deadLetter.originalJobName}</p>
              <p className="font-mono text-xs text-muted">
                {deadLetter.originalQueueName}
                {deadLetter.originalJobId ? ` · ${deadLetter.originalJobId}` : ''}
              </p>
            </DataCell>
            <DataCell className="max-w-md">
              <code className="text-xs text-critical-text">{deadLetter.failureCode}</code>
              <p className="line-clamp-3 text-secondary">{deadLetter.failureMessage}</p>
            </DataCell>
            <DataCell isNumeric>{formatInteger(deadLetter.attemptsMade)}</DataCell>
            <DataCell className="tabular whitespace-nowrap">{formatShortDateTime(deadLetter.failedAt)}</DataCell>
            <DataCell className="max-w-xs">
              <PayloadSummaryCell payload={deadLetter.payload} />
            </DataCell>
            <DataCell>
              <div className="flex justify-end gap-2">
                <Button
                  size="small"
                  leadingIcon={<RotateCcw aria-hidden="true" className="size-3.5" />}
                  isLoading={retryingDeadLetterId === deadLetter.id}
                  disabled={retryingDeadLetterId !== null}
                  onClick={() => onRetry(deadLetter)}
                >
                  Retry job
                </Button>
                <Button
                  size="small"
                  variant="danger"
                  leadingIcon={<Trash2 aria-hidden="true" className="size-3.5" />}
                  onClick={() => onDiscard(deadLetter)}
                >
                  Discard
                </Button>
              </div>
            </DataCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function PayloadSummaryCell({ payload }: { payload: unknown }) {
  const summary = summarisePayload(payload);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-mono text-secondary">
        {summary.fields.length === 0 ? 'Empty payload' : summary.fields.join(', ')}
        {summary.hiddenFieldCount > 0 ? ` +${String(summary.hiddenFieldCount)} more` : ''}
      </summary>
      {summary.enqueuedAt ? <p className="mt-1 text-muted">Queued {formatShortDateTime(summary.enqueuedAt)}</p> : null}
      <pre className="mt-1 max-h-64 overflow-auto rounded border border-border bg-surface-raised p-2 text-xs text-secondary">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}
