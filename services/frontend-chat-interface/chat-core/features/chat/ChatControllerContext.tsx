import { createContext, useContext } from 'react';

import type { ChatController } from '@chat-core/features/chat/chatController';

export const ChatControllerContext = createContext<ChatController | null>(null);

export function useChatController(): ChatController {
  const controller = useContext(ChatControllerContext);
  if (!controller) throw new Error('useChatController must be used inside <ChatControllerContext.Provider>');
  return controller;
}
