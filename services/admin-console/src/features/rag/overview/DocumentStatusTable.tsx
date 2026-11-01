import { Link } from 'react-router';

import { formatInteger } from '@/shared/lib/format';
import { ROUTE_PATHS } from '@/shared/routePaths';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { EmptyState } from '@/shared/ui/StatusMessages';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import { placardForStatusName } from '../documents/documentStatusModel';
import type { RagDocumentStatusCount } from './api/overviewTypes';

/** The library by ingestion status: how much is searchable and how much is switched off. */
export function DocumentStatusTable({ documentCounts }: { documentCounts: readonly RagDocumentStatusCount[] }) {
  if (documentCounts.length === 0) {
    return (
      <EmptyState
        title="No documents yet"
        action={
          <Link className="text-sm font-medium text-accent hover:underline" to={ROUTE_PATHS.ragDocuments}>
            Upload a document
          </Link>
        }
      />
    );
  }
  return (
    <Table caption="Documents by status">
      <thead>
        <tr>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell isNumeric>Documents</HeaderCell>
          <HeaderCell isNumeric>Enabled</HeaderCell>
          <HeaderCell isNumeric>Disabled</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {documentCounts.map((documentCount) => (
          <tr key={documentCount.status}>
            <DataCell>
              <StatePlacard {...placardForStatusName(documentCount.status)} />
            </DataCell>
            <DataCell isNumeric>{formatInteger(documentCount.total)}</DataCell>
            <DataCell isNumeric>{formatInteger(documentCount.enabled)}</DataCell>
            <DataCell isNumeric>{formatInteger(documentCount.total - documentCount.enabled)}</DataCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
