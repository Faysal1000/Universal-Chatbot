import { joinClassNames } from '@/shared/lib/classNames';
import { formatInteger, formatShortDateTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { IndexVersion } from '../api/indexVersionTypes';
import { describeEmbeddingModel, indexVersionActions, indexVersionPlacard, isRollback } from '../indexVersionModel';

export interface IndexVersionsTableProps {
  versions: readonly IndexVersion[];
  liveVersion: IndexVersion | undefined;
  buildingVersionId: number | null;
  onBuild: (version: IndexVersion) => void;
  onPromote: (version: IndexVersion) => void;
  onDelete: (version: IndexVersion) => void;
}

export function IndexVersionsTable(props: IndexVersionsTableProps) {
  return (
    <Table caption="Index versions, newest first">
      <thead>
        <tr>
          <HeaderCell>Version</HeaderCell>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell>Embedding model</HeaderCell>
          <HeaderCell>Chunker and tokenizer</HeaderCell>
          <HeaderCell isNumeric>Missing documents</HeaderCell>
          <HeaderCell>Created</HeaderCell>
          <HeaderCell>Promoted</HeaderCell>
          <HeaderCell>
            <span className="sr-only">Actions</span>
          </HeaderCell>
        </tr>
      </thead>
      <tbody>
        {props.versions.map((version) => (
          <IndexVersionRow key={version.id} version={version} {...props} />
        ))}
      </tbody>
    </Table>
  );
}

function IndexVersionRow({
  version,
  liveVersion,
  buildingVersionId,
  onBuild,
  onPromote,
  onDelete,
}: Omit<IndexVersionsTableProps, 'versions'> & { version: IndexVersion }) {
  const placard = indexVersionPlacard(version.status);
  const actions = indexVersionActions(version);
  const isLive = version.status === 'live';
  return (
    <tr className={joinClassNames('align-top', isLive && 'bg-surface-raised')}>
      <DataCell>
        <p className="tabular font-semibold text-primary">v{version.id}</p>
      </DataCell>
      <DataCell>
        <StatePlacard state={placard.state} label={placard.label} />
      </DataCell>
      <DataCell className="text-xs">{describeEmbeddingModel(version)}</DataCell>
      <DataCell className="font-mono text-xs">
        {version.chunkerVersion}
        <br />
        {version.lexicalTokenizerVersion}
      </DataCell>
      <DataCell isNumeric className={joinClassNames(version.missingDocumentCount > 0 && 'text-warning-text')}>
        {formatInteger(version.missingDocumentCount)}
      </DataCell>
      <DataCell className="tabular whitespace-nowrap">{formatShortDateTime(version.createdAt)}</DataCell>
      <DataCell className="tabular whitespace-nowrap">{formatShortDateTime(version.promotedAt)}</DataCell>
      <DataCell>
        <div className="flex flex-wrap justify-end gap-2">
          {actions.canBuild ? (
            <Button size="small" isLoading={buildingVersionId === version.id} onClick={() => onBuild(version)}>
              {version.status === 'building' ? 'Resume build' : 'Catch up'}
            </Button>
          ) : null}
          {actions.canPromote ? (
            <Button size="small" variant="primary" onClick={() => onPromote(version)}>
              {isRollback(version, liveVersion) ? 'Roll back to this' : 'Promote to live'}
            </Button>
          ) : null}
          {actions.canDelete ? (
            <Button size="small" variant="danger" onClick={() => onDelete(version)}>
              Delete
            </Button>
          ) : null}
        </div>
        {actions.promoteBlockedReason ? (
          <p className="mt-1 max-w-56 text-right text-xs text-muted">{actions.promoteBlockedReason}</p>
        ) : null}
      </DataCell>
    </tr>
  );
}
