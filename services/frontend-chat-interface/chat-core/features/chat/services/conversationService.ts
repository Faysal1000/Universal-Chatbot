import type { ChatApiClient } from '@chat-core/api/chatApiClient';
import type { Attachment, Conversation } from '@chat-core/api/chatApiContract';
import { omitKey } from '@chat-core/shared/omitKey';

import { updateThread, upsertConversation, useChatStore } from '../chatStore';
import {
  buildTurnsFromHistory,
  DRAFT_CONVERSATION_KEY,
  EMPTY_THREAD,
  prependHistoryPage,
  refreshAttachments,
} from '../chatThreadModel';

type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

/** Minimum gap between URL refreshes of one conversation; a fresh presigned URL stays valid for 10 minutes. */
const ATTACHMENT_REFRESH_COOLDOWN_MS = 30_000;
/** How many history pages to walk looking for an attachment whose URL expired. */
const ATTACHMENT_REFRESH_MAX_PAGES = 5;

/** Conversation list, history paging and conversation-level edits (rename, delete), with optimistic updates. */
export class ConversationService {
  private readonly lastAttachmentRefresh = new Map<string, number>();

  constructor(
    private readonly api: ChatApiClient,
    private readonly logger: Logger,
  ) {}

  async refreshList(): Promise<void> {
    useChatStore.setState({ conversationsStatus: 'loading' });
    try {
      const page = await this.api.listConversations();
      useChatStore.setState({ conversations: page.items, conversationsStatus: 'ready' });
    } catch (error) {
      useChatStore.setState({ conversationsStatus: 'error' });
      throw error;
    }
  }

  search(query: string, signal?: AbortSignal): Promise<Conversation[]> {
    return this.api.listConversations({ query }, signal).then((page) => page.items);
  }

  /** Loads the newest history page once. Returns false when it could not be loaded. */
  async loadThread(conversationId: string): Promise<boolean> {
    const existing = useChatStore.getState().threads[conversationId];
    if (existing && (existing.loadStatus === 'ready' || existing.loadStatus === 'loading')) return true;
    updateThread(conversationId, (thread) => ({ ...thread, loadStatus: 'loading' }));
    try {
      const page = await this.api.listMessages(conversationId);
      updateThread(conversationId, (thread) => {
        // Keep turns created locally while the history request was in flight.
        const serverTurns = buildTurnsFromHistory(page.items);
        const serverTurnIds = new Set(serverTurns.map((t) => t.turnId));
        return {
          ...thread,
          loadStatus: 'ready',
          olderCursor: page.nextCursor,
          turns: [...serverTurns, ...thread.turns.filter((t) => !serverTurnIds.has(t.turnId))],
        };
      });
      return true;
    } catch (error) {
      this.logger.warn('[chat] could not load conversation', error);
      updateThread(conversationId, (thread) => ({ ...thread, loadStatus: 'error' }));
      return false;
    }
  }

  async loadEarlierMessages(conversationId: string): Promise<void> {
    const thread = useChatStore.getState().threads[conversationId];
    if (!thread?.olderCursor || thread.olderStatus === 'loading') return;
    updateThread(conversationId, (current) => ({ ...current, olderStatus: 'loading' }));
    try {
      const page = await this.api.listMessages(conversationId, { before: thread.olderCursor });
      updateThread(conversationId, (current) => ({
        ...current,
        turns: prependHistoryPage(current.turns, page.items),
        olderCursor: page.nextCursor,
        olderStatus: 'idle',
      }));
    } catch (error) {
      this.logger.warn('[chat] could not load earlier messages', error);
      updateThread(conversationId, (current) => ({ ...current, olderStatus: 'error' }));
    }
  }

  /**
   * An attachment image failed to load, most likely because its presigned URL expired: refetch the history pages
   * until the attachment turns up again, and swap in the fresh URLs.
   */
  async refreshAttachmentUrls(conversationId: string, attachmentId: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastAttachmentRefresh.get(conversationId) ?? 0) < ATTACHMENT_REFRESH_COOLDOWN_MS) return;
    this.lastAttachmentRefresh.set(conversationId, now);

    const fresh = new Map<string, Attachment>();
    let before: string | null = null;
    try {
      for (let pageIndex = 0; pageIndex < ATTACHMENT_REFRESH_MAX_PAGES; pageIndex += 1) {
        const page = await this.api.listMessages(conversationId, { before });
        for (const message of page.items) for (const a of message.attachments) fresh.set(a.id, a);
        if (fresh.has(attachmentId) || !page.nextCursor) break;
        before = page.nextCursor;
      }
    } catch (error) {
      this.logger.warn('[chat] could not refresh attachment URLs', error);
      return;
    }
    updateThread(conversationId, (thread) => ({ ...thread, turns: refreshAttachments(thread.turns, fresh) }));
  }

  /** Optimistic rename; reverts when the server refuses. */
  async rename(conversationId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;
    const previous = useChatStore.getState().conversations.find((c) => c.id === conversationId);
    if (previous) upsertConversation({ ...previous, title: trimmed });
    try {
      upsertConversation(await this.api.renameConversation(conversationId, trimmed));
    } catch (error) {
      if (previous) upsertConversation(previous);
      throw error;
    }
  }

  /** Optimistic delete; the conversation reappears in the list when the server refuses. */
  async delete(conversationId: string): Promise<void> {
    const previous = useChatStore.getState().conversations;
    useChatStore.setState((state) => ({
      conversations: state.conversations.filter((c) => c.id !== conversationId),
      threads: omitKey(state.threads, conversationId),
    }));
    try {
      await this.api.deleteConversation(conversationId);
    } catch (error) {
      useChatStore.setState({ conversations: previous });
      throw error;
    }
  }

  /**
   * A new visitor session replaced an expired one. Conversations belong to a session, so everything but the
   * unsaved draft is gone: forget it and reload the (now empty or different) list.
   */
  async resetForNewSession(): Promise<void> {
    useChatStore.setState((state) => ({
      conversations: [],
      threads: { [DRAFT_CONVERSATION_KEY]: state.threads[DRAFT_CONVERSATION_KEY] ?? EMPTY_THREAD },
      activeConversationKey: DRAFT_CONVERSATION_KEY,
    }));
    this.lastAttachmentRefresh.clear();
    await this.refreshList().catch((error: unknown) => {
      this.logger.warn('[chat] could not reload conversations after session renewal', error);
    });
  }
}
