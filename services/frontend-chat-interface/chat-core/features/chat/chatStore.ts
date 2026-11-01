import { create } from 'zustand';

import type { Conversation, PublicChatConfig } from '@chat-core/api/chatApiContract';
import type { BatchSchedulerSnapshot } from '@chat-core/features/message-batching/messageBatchScheduler';

import {
  DRAFT_CONVERSATION_KEY,
  EMPTY_THREAD,
  type PendingUserMessage,
  type ThreadState,
  type TurnView,
} from './chatThreadModel';

export type BootstrapStatus = 'loading' | 'ready' | 'error';

export interface ChatStoreState {
  bootstrapStatus: BootstrapStatus;
  bootstrapError: string | null;
  config: PublicChatConfig | null;

  conversations: Conversation[];
  conversationsStatus: 'idle' | 'loading' | 'ready' | 'error';

  /** Conversation id, or DRAFT_CONVERSATION_KEY for the unsaved new chat. */
  activeConversationKey: string;
  threads: Record<string, ThreadState>;
  batches: Record<string, BatchSchedulerSnapshot<PendingUserMessage>>;
  /** The single turn currently streaming (backend allows one concurrent stream per visitor session). */
  streamingTurn: { conversationKey: string; turnId: string } | null;
  isOnline: boolean;
}

export const initialChatStoreState: ChatStoreState = {
  bootstrapStatus: 'loading',
  bootstrapError: null,
  config: null,
  conversations: [],
  conversationsStatus: 'idle',
  activeConversationKey: DRAFT_CONVERSATION_KEY,
  threads: {},
  batches: {},
  streamingTurn: null,
  isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
};

/**
 * UI state. Components read it with selectors; only the chat controller and its services write to it, so every state transition
 * lives in one place and components stay declarative.
 */
export const useChatStore = create<ChatStoreState>()(() => initialChatStoreState);

export function findTurn(conversationKey: string, turnId: string): TurnView | undefined {
  return useChatStore.getState().threads[conversationKey]?.turns.find((t) => t.turnId === turnId);
}

// ── Write helpers used by the controller ─────────────────────────────────────────────────────────────────

export function updateThread(conversationKey: string, update: (thread: ThreadState) => ThreadState): void {
  useChatStore.setState((state) => ({
    threads: { ...state.threads, [conversationKey]: update(state.threads[conversationKey] ?? EMPTY_THREAD) },
  }));
}

export function updateTurn(
  conversationKey: string,
  turnId: string,
  update: (turn: TurnView) => TurnView,
): void {
  updateThread(conversationKey, (thread) => ({
    ...thread,
    turns: thread.turns.map((turn) => (turn.turnId === turnId ? update(turn) : turn)),
  }));
}

export function upsertConversation(conversation: Conversation): void {
  useChatStore.setState((state) => {
    const others = state.conversations.filter((c) => c.id !== conversation.id);
    return {
      conversations: [conversation, ...others].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  });
}

// ── Selectors ─────────────────────────────────────────────────────────────────────────────────────────────

export const selectActiveThread = (state: ChatStoreState): ThreadState =>
  state.threads[state.activeConversationKey] ?? EMPTY_THREAD;

/** Whether answers may show their sources (citation chips, source list, preview). On unless the admin turns it off. */
export const selectShowSources = (state: ChatStoreState): boolean => state.config?.showSources ?? true;

export const selectActiveBatch = (
  state: ChatStoreState,
): BatchSchedulerSnapshot<PendingUserMessage> | undefined => state.batches[state.activeConversationKey];
