import { ChevronRight } from 'lucide-react';

import { StatePlacard } from '@/shared/ui/StatePlacard';

import type { ChainStepResponse, TaskRouteResponse } from '../api/routingTypes';
import { BREAKER_PLACARDS } from './breakerPlacards';

function ChainArrow() {
  return <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted" />;
}

function ChainStepItem({ step, isFirst }: { step: ChainStepResponse; isFirst: boolean }) {
  const breakerPlacard = step.breaker_status === 'closed' ? null : BREAKER_PLACARDS[step.breaker_status];
  return (
    <li className="flex items-center gap-1.5 whitespace-nowrap">
      {isFirst ? null : <ChainArrow />}
      <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-raised px-1.5 py-0.5">
        <span className="tabular text-muted">{step.position}</span>
        <span className={step.is_enabled ? 'text-primary' : 'text-muted line-through'}>{step.model_name}</span>
      </span>
      {step.is_enabled ? null : <span className="font-sans text-muted">(disabled)</span>}
      {breakerPlacard ? (
        <StatePlacard
          className="font-sans"
          state={breakerPlacard.state}
          label={`Breaker ${breakerPlacard.label.toLowerCase()}`}
        />
      ) : null}
    </li>
  );
}

/** A route's chain in order: step 1, step 2, …, then the default model when appended. */
export function ChainSummary({ route }: { route: TaskRouteResponse }) {
  return (
    <ol
      className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs"
      aria-label={`Model chain of ${route.task_name}`}
    >
      {route.steps.map((step, index) => (
        <ChainStepItem key={step.position} step={step} isFirst={index === 0} />
      ))}
      {route.append_default_model ? (
        <li className="flex items-center gap-1.5 font-sans whitespace-nowrap text-secondary">
          <ChainArrow />
          default{route.default_model_name ? ` (${route.default_model_name})` : ' (not set)'}
        </li>
      ) : null}
    </ol>
  );
}
