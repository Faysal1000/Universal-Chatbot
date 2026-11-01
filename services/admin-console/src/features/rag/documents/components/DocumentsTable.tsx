import { Link } from 'react-router';

import { formatBytes, formatInteger, formatShortDateTime } from '@/shared/lib/format';
import { documentPath } from '@/shared/routePaths';
import { Button } from '@/shared/ui/Button';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';

import type { DocumentSummary } from '../api/documentTypes';
import { documentDisplayName, mimeTypeLabel } from '../documentStatusModel';
import { DocumentStatus } from './DocumentStatus';

export interface DocumentsTableProps {
  documents: readonly DocumentSummary[];
  /** Ids whose enable switch or reprocess request is in flight. */
  busyDocumentIds: ReadonlySet<string>;
  onSetEnabled: (document: DocumentSummary, isEnabled: boolean) => void;
  onReprocess: (document: DocumentSummary) => void;
  onDelete: (document: DocumentSummary) => void;
}

export function DocumentsTable({
  documents,
  busyDocumentIds,
  onSetEnabled,
  onReprocess,
  onDelete,
}: DocumentsTableProps) {
  return (
    <Table caption="Documents">
      <thead>
        <tr>
          <HeaderCell>Document</HeaderCell>
          <HeaderCell>Type</HeaderCell>
          <HeaderCell isNumeric>Pages</HeaderCell>
          <HeaderCell isNumeric>Size</HeaderCell>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell>Enabled</HeaderCell>
          <HeaderCell>Updated</HeaderCell>
          <HeaderCell>
            <span className="sr-only">Actions</span>
          </HeaderCell>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => (
          <DocumentRow
            key={document.id}
            document={document}
            isBusy={busyDocumentIds.has(document.id)}
            onSetEnabled={(isEnabled) => onSetEnabled(document, isEnabled)}
            onReprocess={() => onReprocess(document)}
            onDelete={() => onDelete(document)}
          />
        ))}
      </tbody>
    </Table>
  );
}

interface DocumentRowProps {
  document: DocumentSummary;
  isBusy: boolean;
  onSetEnabled: (isEnabled: boolean) => void;
  onReprocess: () => void;
  onDelete: () => void;
}

function DocumentRow({ document, isBusy, onSetEnabled, onReprocess, onDelete }: DocumentRowProps) {
  const displayName = documentDisplayName(document);
  const isDeleting = document.status === 'deleting';
  return (
    <tr className="hover:bg-surface-hover">
      <DataCell className="max-w-80">
        <Link to={documentPath(document.id)} className="block truncate font-medium text-primary hover:text-accent">
          {displayName}
        </Link>
        {document.title ? <span className="block truncate text-xs text-muted">{document.originalFilename}</span> : null}
      </DataCell>
      <DataCell>{mimeTypeLabel(document.mimeType)}</DataCell>
      <DataCell isNumeric>{formatInteger(document.pageCount)}</DataCell>
      <DataCell isNumeric className="whitespace-nowrap">
        {formatBytes(document.byteSize)}
      </DataCell>
      <DataCell>
        <DocumentStatus document={document} />
      </DataCell>
      <DataCell>
        <ToggleSwitch
          isOn={document.isEnabled}
          onChange={onSetEnabled}
          label={`Use ${displayName} in answers`}
          isLabelVisuallyHidden
          disabled={isBusy || isDeleting}
        />
      </DataCell>
      <DataCell className="tabular whitespace-nowrap">{formatShortDateTime(document.updatedAt)}</DataCell>
      <DataCell className="text-right whitespace-nowrap">
        <Button
          size="small"
          variant="ghost"
          aria-label={`Reprocess ${displayName}`}
          disabled={isBusy || isDeleting}
          onClick={onReprocess}
        >
          Reprocess
        </Button>
        <Button
          size="small"
          variant="ghost"
          className="text-critical-text"
          aria-label={`Delete ${displayName}`}
          disabled={isDeleting}
          onClick={onDelete}
        >
          Delete
        </Button>
      </DataCell>
    </tr>
  );
}
