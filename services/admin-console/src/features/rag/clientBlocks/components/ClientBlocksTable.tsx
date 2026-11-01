import { formatDateTime, formatShortDateTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { ClientBlock } from '../api/clientBlockTypes';
import { clientBlockState, describeBlockTarget } from '../clientBlockFormModel';

export interface ClientBlocksTableProps {
  blocks: readonly ClientBlock[];
  nowEpochMilliseconds: number;
  onLift: (block: ClientBlock) => void;
}

export function ClientBlocksTable({ blocks, nowEpochMilliseconds, onLift }: ClientBlocksTableProps) {
  return (
    <Table caption="Blocked clients, newest first">
      <thead>
        <tr>
          <HeaderCell>State</HeaderCell>
          <HeaderCell>Blocks</HeaderCell>
          <HeaderCell>Reason</HeaderCell>
          <HeaderCell>Ends</HeaderCell>
          <HeaderCell>Created</HeaderCell>
          <HeaderCell>
            <span className="sr-only">Actions</span>
          </HeaderCell>
        </tr>
      </thead>
      <tbody>
        {blocks.map((block) => {
          const placard = clientBlockState(block, nowEpochMilliseconds);
          return (
            <tr key={block.id}>
              <DataCell>
                <StatePlacard state={placard.state} label={placard.label} />
              </DataCell>
              <DataCell>{describeBlockTarget(block)}</DataCell>
              <DataCell className="max-w-md">
                <span className="line-clamp-2">{block.reason}</span>
              </DataCell>
              <DataCell className="tabular whitespace-nowrap">
                {block.expiresAt === null ? 'Never' : formatDateTime(block.expiresAt)}
              </DataCell>
              <DataCell className="tabular whitespace-nowrap">{formatShortDateTime(block.createdAt)}</DataCell>
              <DataCell className="text-right">
                <Button size="small" variant="danger" onClick={() => onLift(block)}>
                  Lift block
                </Button>
              </DataCell>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
