import { Link } from 'react-router';

import { formatDateTime } from '@/shared/lib/format';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { AuditEvent } from '../api/auditTypes';
import {
  auditTargetPath,
  describeActor,
  describeAuditAction,
  describeTargetType,
  summariseAuditDetails,
} from '../auditModel';

export function AuditEventsTable({ events }: { events: readonly AuditEvent[] }) {
  return (
    <Table caption="Administrative changes, newest first">
      <thead>
        <tr>
          <HeaderCell>Time</HeaderCell>
          <HeaderCell>Actor</HeaderCell>
          <HeaderCell>Action</HeaderCell>
          <HeaderCell>Target</HeaderCell>
          <HeaderCell>Details</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className="align-top">
            <DataCell className="tabular whitespace-nowrap">{formatDateTime(event.occurredAt)}</DataCell>
            <DataCell className="whitespace-nowrap" title={event.actorAdminUserId ?? undefined}>
              {describeActor(event)}
            </DataCell>
            <DataCell className="text-primary" title={event.action}>
              {describeAuditAction(event.action)}
            </DataCell>
            <DataCell>
              <AuditTarget event={event} />
            </DataCell>
            <DataCell className="max-w-md">
              <AuditDetails event={event} />
            </DataCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function AuditTarget({ event }: { event: AuditEvent }) {
  if (event.targetType === null) return <span className="text-muted">None</span>;
  const targetPath = auditTargetPath(event);
  return (
    <>
      <p>{describeTargetType(event.targetType)}</p>
      {event.targetId === null ? null : targetPath === null ? (
        <p className="font-mono text-xs break-all text-muted">{event.targetId}</p>
      ) : (
        <Link to={targetPath} className="font-mono text-xs break-all text-secondary hover:text-accent hover:underline">
          {event.targetId}
        </Link>
      )}
    </>
  );
}

function AuditDetails({ event }: { event: AuditEvent }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-secondary">{summariseAuditDetails(event.details)}</summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded border border-border bg-surface-raised p-2 text-secondary">
        {JSON.stringify(event.details, null, 2)}
      </pre>
      <p className="mt-1 font-mono break-all text-muted">request {event.requestId ?? '—'}</p>
    </details>
  );
}
