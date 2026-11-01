import type { ConversationFilters } from './conversationTypes';

/** TanStack Query keys for admin conversations. */
export const conversationQueryKeys = {
  all: ['rag', 'conversations'] as const,
  list: (filters: ConversationFilters) => [...conversationQueryKeys.all, 'list', filters] as const,
  detail: (conversationId: string) => [...conversationQueryKeys.all, 'detail', conversationId] as const,
};
