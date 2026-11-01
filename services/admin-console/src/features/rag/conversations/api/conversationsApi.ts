import { requestRagApi } from '@/shared/api/httpClient';

import { CONVERSATION_PAGE_SIZE } from './conversationTypes';
import type { ConversationDetail, ConversationFilters, ConversationPage } from './conversationTypes';

export function listConversations(
  filters: ConversationFilters,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<ConversationPage> {
  return requestRagApi<ConversationPage>('/conversations', {
    queryParameters: {
      q: filters.searchText.trim(),
      visitorSessionId: filters.visitorSessionId.trim(),
      cursor,
      limit: CONVERSATION_PAGE_SIZE,
    },
    signal,
  });
}

export function getConversation(conversationId: string): Promise<ConversationDetail> {
  return requestRagApi<ConversationDetail>(`/conversations/${encodeURIComponent(conversationId)}`);
}

/** `force` deletes even while a reply is being written, cancelling it. */
export function deleteConversation(conversationId: string, force: boolean): Promise<void> {
  return requestRagApi<undefined>(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
    queryParameters: { force },
  });
}
