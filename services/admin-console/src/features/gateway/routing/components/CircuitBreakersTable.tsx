import { RotateCcw } from 'lucide-react';

import {
  MISSING_VALUE_PLACEHOLDER,
  formatInteger,
  formatSecondsAsDuration,
  formatShortDateTime,
} from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { CircuitBreakerResponse } from '../api/routingTypes';
import { BREAKER_PLACARDS } from './breakerPlacards';

export interface CircuitBreakersTableProps {
  breakers: readonly CircuitBreakerResponse[];
  onReset: (breaker: CircuitBreakerResponse) => void;
}

function describeCooldown(breaker: CircuitBreakerResponse): string {
  if (breaker.status === 'open') {
    return `${formatSecondsAsDuration(breaker.cooldown_remaining_seconds)} of ${formatSecondsAsDuration(breaker.cooldown_seconds)}`;
  }
  if (breaker.status === 'half_open') return 'Trial pending';
  return MISSING_VALUE_PLACEHOLDER;
}

/** Models with recent consecutive failures, their breaker state, and how long chains still skip them. */
export function CircuitBreakersTable({ breakers, onReset }: CircuitBreakersTableProps) {
  return (
    <Table caption="Circuit breakers">
      <thead>
        <tr>
          <HeaderCell>Model</HeaderCell>
          <HeaderCell>State</HeaderCell>
          <HeaderCell isNumeric>Failures / threshold</HeaderCell>
          <HeaderCell isNumeric>Cooldown left</HeaderCell>
          <HeaderCell isNumeric>Times opened</HeaderCell>
          <HeaderCell>Last error</HeaderCell>
          <HeaderCell>Last failure</HeaderCell>
          <HeaderCell>
            <span className="sr-only">Actions</span>
          </HeaderCell>
        </tr>
      </thead>
      <tbody>
        {breakers.map((breaker) => (
          <tr key={breaker.model_pk} className="hover:bg-surface-hover">
            <DataCell className="font-mono text-xs whitespace-nowrap">{breaker.model_name}</DataCell>
            <DataCell>
              <StatePlacard {...BREAKER_PLACARDS[breaker.status]} />
            </DataCell>
            <DataCell isNumeric className={breaker.status === 'closed' ? undefined : 'text-critical-text'}>
              {formatInteger(breaker.consecutive_failures)} / {formatInteger(breaker.failure_threshold)}
            </DataCell>
            <DataCell isNumeric className="whitespace-nowrap">
              {describeCooldown(breaker)}
            </DataCell>
            <DataCell isNumeric>{formatInteger(breaker.opened_count)}</DataCell>
            <DataCell className="font-mono text-xs">{breaker.last_error_class ?? MISSING_VALUE_PLACEHOLDER}</DataCell>
            <DataCell className="whitespace-nowrap">{formatShortDateTime(breaker.last_failure_at)}</DataCell>
            <DataCell className="text-right">
              <Button
                size="small"
                variant="ghost"
                leadingIcon={<RotateCcw aria-hidden="true" className="size-3.5" />}
                aria-label={`Reset the breaker of ${breaker.model_name}`}
                onClick={() => onReset(breaker)}
              >
                Reset
              </Button>
            </DataCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
