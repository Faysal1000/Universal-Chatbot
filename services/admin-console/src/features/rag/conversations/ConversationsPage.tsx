import { useSearchParams } from 'react-router';

import { describeError } from '@/shared/api/httpClient';
import { joinClassNames } from '@/shared/lib/classNames';
import { Button, RefreshButton } from '@/shared/ui/Button';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';

import { useConversationPages } from './api/conversationQueries';
import type { ConversationFilters } from './api/conversationTypes';
import { ConversationFiltersBar } from './components/ConversationFiltersBar';
import { ConversationsTable } from './components/ConversationsTable';
import {
  hasActiveConversationFilters,
  readConversationFilters,
  toConversationSearchParameters,
} from './conversationFilters';

export function ConversationsPage() {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const filters = readConversationFilters(searchParameters);
  const conversationPagesQuery = useConversationPages(filters);
  const conversations = conversationPagesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const isFiltered = hasActiveConversationFilters(filters);

  const applyFilters = (nextFilters: ConversationFilters) => {
    setSearchParameters(toConversationSearchParameters(nextFilters));
  };

  return (
    <>
      <PageHeader
        title="Conversations"
        actions={
          <RefreshButton
            isRefreshing={conversationPagesQuery.isFetching && !conversationPagesQuery.isFetchingNextPage}
            onRefresh={() => void conversationPagesQuery.refetch()}
          />
        }
      />
      <ConversationFiltersBar key={searchParameters.toString()} appliedFilters={filters} onApply={applyFilters} />
      <Card bodyClassName="p-0">
        {conversationPagesQuery.isPending ? (
          <LoadingState label="Loading conversations…" />
        ) : conversationPagesQuery.isError ? (
          <div className="p-4">
            <ErrorBanner
              title="Could not load conversations"
              message={describeError(conversationPagesQuery.error)}
              onRetry={() => void conversationPagesQuery.refetch()}
            />
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState
            title={isFiltered ? 'No conversations match these filters' : 'No conversations yet'}
            description={isFiltered ? 'Search covers titles and message text.' : undefined}
          />
        ) : (
          <div className={joinClassNames(conversationPagesQuery.isPlaceholderData && 'is-refetching')}>
            <ConversationsTable conversations={conversations} />
            {conversationPagesQuery.hasNextPage ? (
              <div className="flex justify-center border-t border-border p-3">
                <Button
                  isLoading={conversationPagesQuery.isFetchingNextPage}
                  onClick={() => void conversationPagesQuery.fetchNextPage()}
                >
                  Load older conversations
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </>
  );
}
