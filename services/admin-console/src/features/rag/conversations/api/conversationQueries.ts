import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { feedbackQueryKeys } from '../../feedback/api/feedbackQueryKeys';

import { conversationQueryKeys } from './conversationQueryKeys';
import type { ConversationFilters, ConversationPage } from './conversationTypes';
import { deleteConversation, getConversation, listConversations } from './conversationsApi';

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

/** Its feedback goes with it, so both lists refresh. */
export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, force }: { conversationId: string; force: boolean }) =>
      deleteConversation(conversationId, force),
    onSuccess: (_result, { conversationId }) => {
      queryClient.removeQueries({ queryKey: conversationQueryKeys.detail(conversationId) });
      void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: feedbackQueryKeys.all });
    },
  });
}
