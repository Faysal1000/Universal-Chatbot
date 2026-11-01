import { formatShortDateTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { WidgetKey } from '../api/widgetKeyTypes';
import { CopyButton } from './CopyButton';

export interface WidgetKeysTableProps {
  widgetKeys: readonly WidgetKey[];
  onShowEmbedCode: (widgetKey: WidgetKey) => void;
  onEdit: (widgetKey: WidgetKey) => void;
  onRevoke: (widgetKey: WidgetKey) => void;
}

export function WidgetKeysTable({ widgetKeys, onShowEmbedCode, onEdit, onRevoke }: WidgetKeysTableProps) {
  return (
    <Table caption="Websites with a chat widget key, newest first">
      <thead>
        <tr>
          <HeaderCell>State</HeaderCell>
          <HeaderCell>Website</HeaderCell>
          <HeaderCell>Allowed origins</HeaderCell>
          <HeaderCell>Publishable key</HeaderCell>
          <HeaderCell className="text-right">Answers / min</HeaderCell>
          <HeaderCell>Created or revoked</HeaderCell>
          <HeaderCell>
            <span className="sr-only">Actions</span>
          </HeaderCell>
        </tr>
      </thead>
      <tbody>
        {widgetKeys.map((widgetKey) => {
          const isActive = widgetKey.status === 'active';
          return (
            <tr key={widgetKey.id}>
              <DataCell>
                <StatePlacard state={isActive ? 'ready' : 'stopped'} label={isActive ? 'Active' : 'Revoked'} />
              </DataCell>
              <DataCell className="min-w-40 font-medium text-primary">{widgetKey.name}</DataCell>
              <DataCell>
                <ul className="flex flex-col gap-0.5 font-mono text-xs text-secondary">
                  {widgetKey.allowedOrigins.map((origin) => (
                    <li key={origin}>{origin}</li>
                  ))}
                </ul>
              </DataCell>
              <DataCell>
                <span className="flex items-center gap-1">
                  <code className="max-w-40 truncate font-mono text-xs text-muted" title={widgetKey.publishableKey}>
                    {widgetKey.publishableKey}
                  </code>
                  <CopyButton text={widgetKey.publishableKey} label="Copy" variant="ghost" />
                </span>
              </DataCell>
              <DataCell className="tabular text-right">{widgetKey.turnsPerMinute}</DataCell>
              <DataCell className="tabular whitespace-nowrap">
                {formatShortDateTime(isActive ? widgetKey.createdAt : widgetKey.revokedAt)}
              </DataCell>
              <DataCell className="text-right whitespace-nowrap">
                {isActive ? (
                  <span className="inline-flex gap-1.5">
                    <Button size="small" onClick={() => onShowEmbedCode(widgetKey)}>
                      Embed code
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => onEdit(widgetKey)}>
                      Edit
                    </Button>
                    <Button size="small" variant="danger" onClick={() => onRevoke(widgetKey)}>
                      Revoke
                    </Button>
                  </span>
                ) : null}
              </DataCell>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
