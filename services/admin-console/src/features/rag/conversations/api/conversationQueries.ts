import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { conversationQueryKeys } from './conversationQueryKeys';
import type { ConversationFilters, ConversationPage } from './conversationTypes';
import { getConversation, listConversations } from './conversationsApi';

export function useConversationPages(filters: ConversationFilters) {
  return useInfiniteQuery({
    queryKey: conversationQueryKeys.list(filters),
    queryFn: ({ pageParam, signal }) => listConversations(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ConversationPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useConversation(conversationId: string) {
  return useQuery({
    queryKey: conversationQueryKeys.detail(conversationId),
    queryFn: () => getConversation(conversationId),
  });
}
