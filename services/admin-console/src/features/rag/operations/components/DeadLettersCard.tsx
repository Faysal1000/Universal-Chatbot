import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { joinClassNames } from '@/shared/lib/classNames';
import { formatInteger } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { Card } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useDeadLetters, useDiscardDeadLetter, useRetryDeadLetter } from '../api/operationsQueries';
import { DEAD_LETTER_PAGE_SIZE } from '../api/operationsTypes';
import type { DeadLetter } from '../api/operationsTypes';
import { describeRetryOutcome, isIngestionQueue, offsetPageInfo } from '../operationsModel';
import { DeadLettersTable } from './DeadLettersTable';

export function DeadLettersCard() {
  const [offset, setOffset] = useState(0);
  const deadLettersQuery = useDeadLetters(offset);
  const retryMutation = useRetryDeadLetter();
  const discardMutation = useDiscardDeadLetter();
  const { showToast } = useToast();
  const [deadLetterPendingDiscard, setDeadLetterPendingDiscard] = useState<DeadLetter | null>(null);

  const retry = (deadLetter: DeadLetter) => {
    retryMutation.mutate(deadLetter.id, {
      onSuccess: (outcome) => showToast(describeRetryOutcome(outcome), 'success'),
      onError: (error) => showToast(describeError(error), 'error'),
    });
  };

  const confirmDiscard = () => {
    if (!deadLetterPendingDiscard) return;
    discardMutation.mutate(deadLetterPendingDiscard.id, {
      onSuccess: () => {
        setDeadLetterPendingDiscard(null);
        showToast('Dead letter discarded.', 'success');
      },
    });
  };

  const total = deadLettersQuery.data?.total ?? 0;
  return (
    <Card
      title="Dead letters"
      actions={
        deadLettersQuery.data ? (
          <span className="tabular text-xs text-muted">{formatInteger(total)} in total</span>
        ) : null
      }
      bodyClassName="p-0"
    >
      {deadLettersQuery.isPending ? (
        <LoadingState label="Loading dead letters…" />
      ) : deadLettersQuery.isError ? (
        <div className="p-4">
          <ErrorBanner
            title="Could not load dead letters"
            message={describeError(deadLettersQuery.error)}
            onRetry={() => void deadLettersQuery.refetch()}
          />
        </div>
      ) : deadLettersQuery.data.items.length === 0 && offset === 0 ? (
        <EmptyState title="No dead letters" />
      ) : (
        <div className={joinClassNames(deadLettersQuery.isPlaceholderData && 'is-refetching')}>
          <DeadLettersTable
            deadLetters={deadLettersQuery.data.items}
            retryingDeadLetterId={retryMutation.isPending ? retryMutation.variables : null}
            onRetry={retry}
            onDiscard={(deadLetter) => {
              discardMutation.reset();
              setDeadLetterPendingDiscard(deadLetter);
            }}
          />
          <OffsetPager
            offset={offset}
            itemCount={deadLettersQuery.data.items.length}
            total={total}
            onOffsetChange={setOffset}
          />
        </div>
      )}
      <ConfirmDialog
        isOpen={deadLetterPendingDiscard !== null}
        title="Discard this dead letter?"
        message={<DiscardConsequence deadLetter={deadLetterPendingDiscard} />}
        confirmLabel="Discard dead letter"
        isConfirming={discardMutation.isPending}
        errorMessage={discardMutation.isError ? describeError(discardMutation.error) : null}
        onConfirm={confirmDiscard}
        onCancel={() => setDeadLetterPendingDiscard(null)}
      />
    </Card>
  );
}

function DiscardConsequence({ deadLetter }: { deadLetter: DeadLetter | null }) {
  if (!deadLetter) return null;
  return (
    <p>
      The failed <code>{deadLetter.originalJobName}</code> job from <code>{deadLetter.originalQueueName}</code> is
      deleted and will not run again.{' '}
      {isIngestionQueue(deadLetter.originalQueueName)
        ? 'Its document stays failed until you reprocess it from the documents page.'
        : 'Whatever it was doing stays undone.'}
    </p>
  );
}

function OffsetPager({
  offset,
  itemCount,
  total,
  onOffsetChange,
}: {
  offset: number;
  itemCount: number;
  total: number;
  onOffsetChange: (offset: number) => void;
}) {
  const pageInfo = offsetPageInfo(offset, DEAD_LETTER_PAGE_SIZE, itemCount, total);
  if (pageInfo.previousOffset === null && pageInfo.nextOffset === null) return null;
  return (
    <nav
      aria-label="Dead letter pages"
      className="flex items-center justify-between border-t border-border px-4 py-2.5"
    >
      <span className="tabular text-xs text-muted">
        {formatInteger(pageInfo.firstItemNumber)}–{formatInteger(pageInfo.lastItemNumber)} of {formatInteger(total)}
      </span>
      <div className="flex gap-2">
        <Button
          size="small"
          disabled={pageInfo.previousOffset === null}
          onClick={() => onOffsetChange(pageInfo.previousOffset ?? 0)}
        >
          Newer
        </Button>
        <Button
          size="small"
          disabled={pageInfo.nextOffset === null}
          onClick={() => onOffsetChange(pageInfo.nextOffset ?? offset)}
        >
          Older
        </Button>
      </div>
    </nav>
  );
}
