import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { formatInteger } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { Card } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useCircuitBreakers, useResetAllCircuitBreakers, useResetCircuitBreaker } from '../api/routingQueries';
import type { CircuitBreakerResponse } from '../api/routingTypes';
import { CircuitBreakersTable } from './CircuitBreakersTable';

/** What to reset: one model's breaker or, with `breaker: undefined`, every breaker. */
interface ResetTarget {
  breaker: CircuitBreakerResponse | undefined;
}

/** Per-model circuit breakers: chains skip a model while its breaker is open. */
export function CircuitBreakersCard() {
  const breakersQuery = useCircuitBreakers();
  const resetOneMutation = useResetCircuitBreaker();
  const resetAllMutation = useResetAllCircuitBreakers();
  const { showToast } = useToast();
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);
  const activeMutation = resetTarget?.breaker ? resetOneMutation : resetAllMutation;

  const openResetConfirmation = (target: ResetTarget) => {
    resetOneMutation.reset();
    resetAllMutation.reset();
    setResetTarget(target);
  };

  const confirmReset = () => {
    const breaker = resetTarget?.breaker;
    if (breaker) {
      resetOneMutation.mutate(breaker.model_pk, {
        onSuccess: () => {
          setResetTarget(null);
          showToast(`Breaker of ${breaker.model_name} reset.`, 'success');
        },
      });
      return;
    }
    resetAllMutation.mutate(undefined, {
      onSuccess: (result) => {
        setResetTarget(null);
        showToast(`Reset ${formatInteger(result.reset_count)} breakers.`, 'success');
      },
    });
  };

  return (
    <Card
      title="Circuit breakers"
      actions={
        <Button
          size="small"
          variant="danger"
          disabled={!breakersQuery.data || breakersQuery.data.length === 0}
          onClick={() => openResetConfirmation({ breaker: undefined })}
        >
          Reset all breakers
        </Button>
      }
      bodyClassName="p-0"
    >
      {breakersQuery.isPending ? (
        <LoadingState />
      ) : breakersQuery.isError ? (
        <div className="p-4">
          <ErrorBanner message={describeError(breakersQuery.error)} onRetry={() => void breakersQuery.refetch()} />
        </div>
      ) : breakersQuery.data.length === 0 ? (
        <EmptyState title="All breakers closed" />
      ) : (
        <CircuitBreakersTable breakers={breakersQuery.data} onReset={(breaker) => openResetConfirmation({ breaker })} />
      )}
      <ConfirmDialog
        isOpen={resetTarget !== null}
        title={
          resetTarget?.breaker
            ? `Reset the breaker of “${resetTarget.breaker.model_name}”?`
            : 'Reset every circuit breaker?'
        }
        message={
          <p>
            {resetTarget?.breaker
              ? 'The breaker closes and chains try this model again on the next request, even if it is still failing.'
              : 'Every breaker closes and chains try all these models again on the next request, even those still failing.'}
          </p>
        }
        confirmLabel={resetTarget?.breaker ? 'Reset breaker' : 'Reset all breakers'}
        isConfirming={activeMutation.isPending}
        errorMessage={activeMutation.isError ? describeError(activeMutation.error) : null}
        onConfirm={confirmReset}
        onCancel={() => setResetTarget(null)}
      />
    </Card>
  );
}
