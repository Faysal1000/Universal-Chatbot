import { useState } from 'react';
import { Link } from 'react-router';

import { describeError } from '@/shared/api/httpClient';
import { joinClassNames } from '@/shared/lib/classNames';
import { formatInteger, formatShortDateTime } from '@/shared/lib/format';
import { ROUTE_PATHS } from '@/shared/routePaths';
import { Button, RefreshButton } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { SelectField } from '@/shared/ui/FormFields';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';
import { useToast } from '@/shared/ui/toastContext';

import { useDeleteFeedback, useRecentFeedback } from './api/feedbackQueries';
import { FEEDBACK_LIMIT_OPTIONS } from './api/feedbackTypes';
import type { FeedbackEntry, FeedbackLimit } from './api/feedbackTypes';
import { countRatings, filterFeedbackByRating, ratedMessageLink } from './feedbackModel';
import type { RatingFilter } from './feedbackModel';

const RATING_FILTER_OPTIONS: readonly { value: RatingFilter; label: string }[] = [
  { value: 'all', label: 'All ratings' },
  { value: 'down', label: 'Not helpful only' },
  { value: 'up', label: 'Helpful only' },
];

const LIMIT_OPTIONS = FEEDBACK_LIMIT_OPTIONS.map((limit) => ({
  value: String(limit),
  label: `Latest ${String(limit)}`,
}));

function isRatingFilter(value: string): value is RatingFilter {
  return RATING_FILTER_OPTIONS.some((option) => option.value === value);
}

function toFeedbackLimit(value: string): FeedbackLimit {
  return FEEDBACK_LIMIT_OPTIONS.find((limit) => String(limit) === value) ?? FEEDBACK_LIMIT_OPTIONS[0];
}

export function FeedbackPage() {
  const [limit, setLimit] = useState<FeedbackLimit>(FEEDBACK_LIMIT_OPTIONS[0]);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const feedbackQuery = useRecentFeedback(limit);
  const deleteFeedbackMutation = useDeleteFeedback();
  const { showToast } = useToast();
  const [entryPendingDelete, setEntryPendingDelete] = useState<FeedbackEntry | null>(null);

  const confirmDelete = () => {
    if (!entryPendingDelete) return;
    deleteFeedbackMutation.mutate(entryPendingDelete.messageId, {
      onSuccess: () => {
        setEntryPendingDelete(null);
        showToast('Feedback deleted.', 'success');
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Feedback"
        actions={
          <RefreshButton isRefreshing={feedbackQuery.isFetching} onRefresh={() => void feedbackQuery.refetch()} />
        }
      />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <SelectField
          label="Rating"
          className="w-48"
          value={ratingFilter}
          options={RATING_FILTER_OPTIONS}
          onChange={(changeEvent) => {
            if (isRatingFilter(changeEvent.target.value)) setRatingFilter(changeEvent.target.value);
          }}
        />
        <SelectField
          label="Show"
          className="w-40"
          value={String(limit)}
          options={LIMIT_OPTIONS}
          onChange={(changeEvent) => setLimit(toFeedbackLimit(changeEvent.target.value))}
        />
      </div>
      {feedbackQuery.isPending ? (
        <LoadingState label="Loading feedback…" />
      ) : feedbackQuery.isError ? (
        <ErrorBanner
          title="Could not load feedback"
          message={describeError(feedbackQuery.error)}
          onRetry={() => void feedbackQuery.refetch()}
        />
      ) : (
        <div className={joinClassNames('flex flex-col gap-3', feedbackQuery.isPlaceholderData && 'is-refetching')}>
          <FeedbackSummary entries={feedbackQuery.data} />
          <Card bodyClassName="p-0">
            <FeedbackList
              entries={filterFeedbackByRating(feedbackQuery.data, ratingFilter)}
              hasAnyFeedback={feedbackQuery.data.length > 0}
              onDelete={(entry) => {
                deleteFeedbackMutation.reset();
                setEntryPendingDelete(entry);
              }}
            />
          </Card>
        </div>
      )}
      <ConfirmDialog
        isOpen={entryPendingDelete !== null}
        title="Delete this feedback?"
        message={<p>The rating and its comment are removed. The answer itself stays in the conversation.</p>}
        confirmLabel="Delete feedback"
        isConfirming={deleteFeedbackMutation.isPending}
        errorMessage={deleteFeedbackMutation.isError ? describeError(deleteFeedbackMutation.error) : null}
        onConfirm={confirmDelete}
        onCancel={() => setEntryPendingDelete(null)}
      />
    </>
  );
}

function FeedbackSummary({ entries }: { entries: readonly FeedbackEntry[] }) {
  const counts = countRatings(entries);
  return (
    <p className="tabular text-sm text-secondary">
      {formatInteger(entries.length)} loaded · {formatInteger(counts.up)} helpful · {formatInteger(counts.down)} not
      helpful · {formatInteger(counts.withComment)} with a comment
    </p>
  );
}

function FeedbackList({
  entries,
  hasAnyFeedback,
  onDelete,
}: {
  entries: readonly FeedbackEntry[];
  hasAnyFeedback: boolean;
  onDelete: (entry: FeedbackEntry) => void;
}) {
  if (entries.length === 0) {
    return hasAnyFeedback ? (
      <EmptyState title="No ratings of this kind" />
    ) : (
      <EmptyState
        title="No feedback yet"
        action={
          <Link className="text-sm font-medium text-accent hover:underline" to={ROUTE_PATHS.ragConversations}>
            Review conversations instead
          </Link>
        }
      />
    );
  }
  return (
    <Table caption="Visitor ratings, newest first">
      <thead>
        <tr>
          <HeaderCell>Rating</HeaderCell>
          <HeaderCell>Question and answer</HeaderCell>
          <HeaderCell>Comment</HeaderCell>
          <HeaderCell>Rated</HeaderCell>
          <HeaderCell>
            <span className="sr-only">Actions</span>
          </HeaderCell>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.messageId}>
            <DataCell>
              <StatePlacard
                state={entry.rating === 'up' ? 'ready' : 'warning'}
                label={entry.rating === 'up' ? 'Helpful' : 'Not helpful'}
              />
            </DataCell>
            <DataCell className="max-w-md text-xs">
              <p className="text-primary">
                <span className="sr-only">Question: </span>
                {entry.questionExcerpt}
              </p>
              <p className="mt-1 text-muted">
                <span className="sr-only">Answer: </span>
                {entry.answerExcerpt}
              </p>
            </DataCell>
            <DataCell className="max-w-xs">
              {entry.comment?.trim() ? (
                <span className="whitespace-pre-wrap text-primary">{entry.comment}</span>
              ) : (
                <span className="text-muted">No comment</span>
              )}
            </DataCell>
            <DataCell className="tabular whitespace-nowrap">{formatShortDateTime(entry.createdAt)}</DataCell>
            <DataCell className="text-right whitespace-nowrap">
              <span className="inline-flex items-center gap-3">
                <Link to={ratedMessageLink(entry)} className="text-sm font-medium text-accent hover:underline">
                  Open the rated answer
                </Link>
                <Button size="small" variant="danger" onClick={() => onDelete(entry)}>
                  Delete
                </Button>
              </span>
            </DataCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
