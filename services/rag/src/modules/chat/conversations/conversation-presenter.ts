import type { ConversationRecord } from '../persistence/conversations.repository.js';
import type { ConversationView } from '../turns/turn-stream-events.js';

export function presentConversation(conversation: ConversationRecord): ConversationView {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessagePreview: conversation.lastMessagePreview,
  };
}
