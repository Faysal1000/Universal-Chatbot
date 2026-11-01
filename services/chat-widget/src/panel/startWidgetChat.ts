import type { ChatController } from '@chat-core/features/chat/chatController';
import { useChatStore } from '@chat-core/features/chat/chatStore';

import { loadActiveConversation } from './widgetChatController';

/**
 * Starts the chat (config, visitor session, conversation list), then reopens the conversation the visitor had
 * open on an earlier page view, if it still belongs to their session.
 */
export async function startWidgetChat(controller: ChatController, storageKeyPrefix: string): Promise<void> {
  await controller.initialize(null);
  const previous = loadActiveConversation(storageKeyPrefix);
  const state = useChatStore.getState();
  if (state.bootstrapStatus !== 'ready' || previous === null) return;
  if (state.conversations.some((conversation) => conversation.id === previous)) {
    await controller.openConversation(previous, { updateUrl: false });
  }
}
