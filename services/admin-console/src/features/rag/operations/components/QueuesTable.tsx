import { joinClassNames } from '@/shared/lib/classNames';
import { formatInteger } from '@/shared/lib/format';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { QueueSummary } from '../api/operationsTypes';
import { consumerLabel, queuePlacard } from '../operationsModel';

export function QueuesTable({ queues }: { queues: readonly QueueSummary[] }) {
  return (
    <Table caption="Job queues with their job counts">
      <thead>
        <tr>
          <HeaderCell>Queue</HeaderCell>
          <HeaderCell>State</HeaderCell>
          <HeaderCell>Consumer</HeaderCell>
          <HeaderCell isNumeric>Waiting</HeaderCell>
          <HeaderCell isNumeric>Active</HeaderCell>
          <HeaderCell isNumeric>Delayed</HeaderCell>
          <HeaderCell isNumeric>Failed</HeaderCell>
          <HeaderCell isNumeric>Completed</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {queues.map((queue) => {
          const placard = queuePlacard(queue);
          return (
            <tr key={queue.queueName}>
              <DataCell className="font-mono text-xs text-primary">{queue.queueName}</DataCell>
              <DataCell>
                <StatePlacard state={placard.state} label={placard.label} />
              </DataCell>
              <DataCell>{consumerLabel(queue.consumer)}</DataCell>
              <DataCell isNumeric>{formatInteger(queue.counts.waiting)}</DataCell>
              <DataCell isNumeric>{formatInteger(queue.counts.active)}</DataCell>
              <DataCell isNumeric>{formatInteger(queue.counts.delayed)}</DataCell>
              <DataCell
                isNumeric
                className={joinClassNames(queue.counts.failed > 0 && 'font-semibold text-critical-text')}
              >
                {formatInteger(queue.counts.failed)}
              </DataCell>
              <DataCell isNumeric>{formatInteger(queue.counts.completed)}</DataCell>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
