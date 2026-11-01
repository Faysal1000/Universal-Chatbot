import type { ChatApiClient } from '@chat-core/api/chatApiClient';
import type {
  Attachment,
  Conversation,
  FeedbackRating,
  PublicChatConfig,
  SubmitTurnRequest,
} from '@chat-core/api/chatApiContract';
import type { BatchingConfig, ChatPersistence } from '@chat-core/features/message-batching/chatPersistence';
import type { FlushReason, SchedulerClock } from '@chat-core/features/message-batching/messageBatchScheduler';
import { omitKey } from '@chat-core/shared/omitKey';

import {
  findTurn,
  initialChatStoreState,
  updateThread,
  updateTurn,
  upsertConversation,
  useChatStore,
} from './chatStore';
import {
  createWaitingReply,
  DRAFT_CONVERSATION_KEY,
  isReplyInFlight,
  replyErrorFrom,
  type PendingUserMessage,
  type TurnView,
  type UserMessageView,
} from './chatThreadModel';
import { BatchSchedulerRegistry } from './services/batchSchedulerRegistry';
import { watchBrowserLifecycle, type BrowserLifecycle } from './services/browserLifecycle';
import { ConversationService } from './services/conversationService';
import { TurnStreamRunner } from './services/turnStreamRunner';

type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

export interface ChatControllerOptions {
  api: ChatApiClient;
  batching: BatchingConfig;
  persistence: ChatPersistence;
  clock?: SchedulerClock;
  createId?: () => string;
  /** Called when the active conversation changes, so the router can update the URL. */
  onActiveConversationChange?: (conversationId: string | null, mode: 'push' | 'replace') => void;
  /** Tells the user something happened that they did not trigger (e.g. their session was renewed). */
  onNotice?: (notice: 'sessionRenewed') => void;
  /** The server configuration arrived (bot name, limits, features), e.g. to title the page. */
  onConfigLoaded?: (config: PublicChatConfig) => void;
  logger?: Logger;
}

/**
 * Entry point for the UI. Composes the chat's services: per-conversation batch schedulers decide when to send,
 * the turn stream runner sends one turn at a time and reduces its events into the store, and the conversation
 * service owns the list and history. Components call these methods and render the store; they hold no logic.
 */
export class ChatController {
  private readonly api: ChatApiClient;
  private readonly createId: () => string;
  private readonly logger: Logger;
  private readonly persistence: ChatPersistence;
  private readonly conversations: ConversationService;
  private readonly schedulers: BatchSchedulerRegistry;
  private readonly turns: TurnStreamRunner;
  private lifecycle: BrowserLifecycle | null = null;
  private draftCreation: Promise<string> | null = null;

  constructor(private readonly options: ChatControllerOptions) {
    this.api = options.api;
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.logger = options.logger ?? console;
    this.persistence = options.persistence;
    this.conversations = new ConversationService(this.api, this.logger);
    this.schedulers = new BatchSchedulerRegistry({
      batching: options.batching,
      pendingBatches: options.persistence.pendingBatches,
      ...(options.clock ? { clock: options.clock } : {}),
      onFlush: (conversationKey, batch, reason) => void this.submitBatch(conversationKey, batch, reason),
    });
    this.turns = new TurnStreamRunner({
      api: this.api,
      inFlightTurns: options.persistence.inFlightTurns,
      logger: this.logger,
      isPageUnloading: () => this.lifecycle?.isPageUnloading ?? false,
      onConversationIdle: (conversationId) => this.schedulers.release(conversationId),
    });
  }

  get apiClient(): ChatApiClient {
    return this.api;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────────────────────────────────

  async initialize(initialConversationId: string | null): Promise<void> {
    useChatStore.setState({
      ...initialChatStoreState,
      activeConversationKey: initialConversationId ?? DRAFT_CONVERSATION_KEY,
    });
    this.lifecycle?.dispose();
    this.lifecycle = watchBrowserLifecycle({
      // Closing the tab is covered by the persisted pending batches instead: a request started during unload is unreliable.
      onHidden: () => this.schedulers.flushAllForHiddenPage(),
      onOnlineChange: (isOnline) => useChatStore.setState({ isOnline }),
    });

    try {
      await this.bootstrap();
    } catch (error) {
      this.logger.error('[chat] bootstrap failed', error);
      useChatStore.setState({
        bootstrapStatus: 'error',
        bootstrapError: error instanceof Error ? error.message : 'Could not start the chat.',
      });
      return;
    }

    this.restorePersistedBatches();
    this.resubmitUnacknowledgedTurns();
    if (initialConversationId) await this.loadThread(initialConversationId);
  }

  dispose(): void {
    this.lifecycle?.dispose();
    this.schedulers.dispose();
    this.turns.dispose();
  }

  /**
   * The visitor session expired and a new one replaced it. Conversations belong to a session, so the old ones
   * are gone; messages still waiting to be sent move to a new chat instead of being lost.
   */
  handleSessionReplaced(): void {
    const activeKey = useChatStore.getState().activeConversationKey;
    if (activeKey !== DRAFT_CONVERSATION_KEY) {
      this.schedulers.move(activeKey, DRAFT_CONVERSATION_KEY, { hold: false });
    }
    // Turns not yet answered (including the one whose request renewed the session) go to the new chat too.
    for (const record of this.persistence.inFlightTurns.loadAll()) {
      this.persistence.inFlightTurns.remove(record.turnId);
      this.schedulers.obtain(DRAFT_CONVERSATION_KEY).restore(record.messages);
    }
    this.turns.stop();
    this.options.onActiveConversationChange?.(null, 'replace');
    this.options.onNotice?.('sessionRenewed');
    void this.conversations.resetForNewSession();
  }

  private async bootstrap(): Promise<void> {
    const config = await this.api.getConfig();
    useChatStore.setState({ config });
    this.options.onConfigLoaded?.(config);
    await this.api.ensureSession();
    await this.conversations.refreshList();
    useChatStore.setState({ bootstrapStatus: 'ready' });
  }

  private restorePersistedBatches(): void {
    for (const [conversationKey, messages] of Object.entries(this.persistence.pendingBatches.loadAll())) {
      if (this.isKnownConversationKey(conversationKey)) {
        this.schedulers.obtain(conversationKey).restore(messages);
      } else {
        this.persistence.pendingBatches.save(conversationKey, []);
      }
    }
  }

  /** Turns flushed but never acknowledged (tab closed mid-request): resend with the same idempotent turn id. */
  private resubmitUnacknowledgedTurns(): void {
    for (const record of this.persistence.inFlightTurns.loadAll()) {
      if (record.conversationKey === DRAFT_CONVERSATION_KEY) {
        // The conversation was never created, so the server cannot have the turn: queue the messages again.
        this.persistence.inFlightTurns.remove(record.turnId);
        this.schedulers.obtain(DRAFT_CONVERSATION_KEY).restore(record.messages);
      } else if (this.isKnownConversationKey(record.conversationKey)) {
        void this.submitBatch(record.conversationKey, record.messages, 'resumed', record.turnId);
      } else {
        this.persistence.inFlightTurns.remove(record.turnId);
      }
    }
  }

  private isKnownConversationKey(conversationKey: string): boolean {
    return (
      conversationKey === DRAFT_CONVERSATION_KEY ||
      useChatStore.getState().conversations.some((c) => c.id === conversationKey)
    );
  }

  // ── Conversations ───────────────────────────────────────────────────────────────────────────────────────

  searchConversations(query: string, signal?: AbortSignal): Promise<Conversation[]> {
    return this.conversations.search(query, signal);
  }

  /** Switches the visible conversation (null = new chat). Schedulers of other conversations keep running. */
  async openConversation(
    conversationId: string | null,
    options: { updateUrl?: boolean } = {},
  ): Promise<void> {
    const key = conversationId ?? DRAFT_CONVERSATION_KEY;
    if (useChatStore.getState().activeConversationKey === key) return;
    useChatStore.setState({ activeConversationKey: key });
    if (options.updateUrl !== false) this.options.onActiveConversationChange?.(conversationId, 'push');
    if (conversationId) await this.loadThread(conversationId);
  }

  loadEarlierMessages(): Promise<void> {
    return this.conversations.loadEarlierMessages(useChatStore.getState().activeConversationKey);
  }

  /** An attachment image failed to load: its signed URL probably expired, so fetch fresh ones. */
  refreshAttachmentUrls(attachmentId: string): void {
    const conversationKey = useChatStore.getState().activeConversationKey;
    if (conversationKey === DRAFT_CONVERSATION_KEY) return;
    void this.conversations.refreshAttachmentUrls(conversationKey, attachmentId);
  }

  renameConversation(conversationId: string, title: string): Promise<void> {
    return this.conversations.rename(conversationId, title);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    if (this.turns.activeStream?.conversationId === conversationId) this.turns.stop();
    this.schedulers.remove(conversationId);
    const deletion = this.conversations.delete(conversationId);
    if (useChatStore.getState().activeConversationKey === conversationId) await this.openConversation(null);
    await deletion;
  }

  private async loadThread(conversationId: string): Promise<void> {
    const loaded = await this.conversations.loadThread(conversationId);
    if (loaded) this.resumeOrphanTurn(conversationId);
  }

  /** A trailing turn without a reply may still be generating server-side (e.g. after a reload): re-attach. */
  private resumeOrphanTurn(conversationId: string): void {
    const last = useChatStore.getState().threads[conversationId]?.turns.at(-1);
    if (last?.reply.serverId !== null || this.turns.activeStream?.turnId === last.turnId) return;
    updateTurn(conversationId, last.turnId, (turn) => ({ ...turn, reply: createWaitingReply() }));
    void this.turns.enqueue(conversationId, last.turnId, null);
  }

  // ── Composing and batching ──────────────────────────────────────────────────────────────────────────────

  /** Adds a message to the active conversation's batch; it is shown at once and sent after the quiet window. */
  sendMessage(content: string, attachments: Attachment[] = []): void {
    const trimmed = content.trim();
    if (!trimmed && attachments.length === 0) return;
    this.schedulers.obtain(this.activeKey()).enqueue({
      clientMessageId: this.createId(),
      content: trimmed,
      attachments,
      createdAt: new Date().toISOString(),
    });
  }

  noteTyping(): void {
    this.schedulers.get(this.activeKey())?.noteTyping();
  }

  /** Editing a pending message down to nothing removes it (unless it still carries images). */
  editPendingMessage(clientMessageId: string, content: string): void {
    const scheduler = this.schedulers.get(this.activeKey());
    if (!scheduler) return;
    const trimmed = content.trim();
    const message = scheduler.snapshot().pending.find((m) => m.clientMessageId === clientMessageId);
    if (!trimmed && message?.attachments.length === 0) scheduler.removePending(clientMessageId);
    else scheduler.updatePending(clientMessageId, (pending) => ({ ...pending, content: trimmed }));
  }

  removePendingMessage(clientMessageId: string): void {
    this.schedulers.get(this.activeKey())?.removePending(clientMessageId);
  }

  // ── Turns ───────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Stops the active conversation's reply. A streaming reply is cancelled on the server and its partial
   * answer kept; one not sent yet is dropped before it leaves. Either way the question stays in the thread.
   */
  stopGeneration(): void {
    const conversationKey = this.activeKey();
    if (this.turns.activeStream?.conversationId === conversationKey) {
      this.turns.stop();
      return;
    }
    const last = useChatStore.getState().threads[conversationKey]?.turns.at(-1);
    if (!last || !isReplyInFlight(last.reply)) return;
    this.persistence.inFlightTurns.remove(last.turnId);
    updateTurn(conversationKey, last.turnId, (turn) => ({
      ...turn,
      reply: { ...turn.reply, phase: 'stopped', stage: null, finishReason: 'cancelled' },
    }));
  }

  /** Regenerates the latest reply (also used to retry a failed one): same messages, new turn id. */
  regenerateTurn(turnId: string): void {
    const turn = this.latestTurn(turnId);
    if (turn) this.replaceLatestTurn(turn, turn.userMessages);
  }

  /** Edits one message of the latest turn and resends it; the server only lets the latest turn be replaced. */
  editAndResend(turnId: string, clientMessageId: string, content: string): void {
    const turn = this.latestTurn(turnId);
    const trimmed = content.trim();
    if (!turn || !trimmed) return;
    const edited = turn.userMessages.map((m) =>
      m.clientMessageId === clientMessageId ? { ...m, content: trimmed } : m,
    );
    this.replaceLatestTurn(turn, edited);
  }

  async sendFeedback(turnId: string, rating: FeedbackRating): Promise<void> {
    const conversationId = this.activeKey();
    const turn = findTurn(conversationId, turnId);
    const messageId = turn?.reply.serverId;
    if (!messageId) return;
    const previous = turn.reply.feedback;
    updateTurn(conversationId, turnId, (t) => ({ ...t, reply: { ...t.reply, feedback: rating } }));
    try {
      await this.api.sendFeedback(messageId, rating);
    } catch (error) {
      updateTurn(conversationId, turnId, (t) => ({ ...t, reply: { ...t.reply, feedback: previous } }));
      throw error;
    }
  }

  private async submitBatch(
    conversationKey: string,
    batch: PendingUserMessage[],
    reason: FlushReason,
    resumedTurnId?: string,
  ): Promise<void> {
    const turnId = resumedTurnId ?? this.createId();
    // Recorded synchronously, before any await, so an unload right now cannot lose the batch.
    this.persistence.inFlightTurns.save({ turnId, conversationKey, messages: batch });
    // Held before anything async, so messages typed from now on wait for this reply.
    this.schedulers.obtain(conversationKey).hold();
    this.appendTurn(conversationKey, { turnId, userMessages: batch.map((m) => ({ ...m, serverId: null })) });

    let conversationId: string;
    try {
      conversationId =
        conversationKey === DRAFT_CONVERSATION_KEY ? await this.materializeDraft() : conversationKey;
    } catch (error) {
      this.failDraftTurn(conversationKey, turnId, error);
      return;
    }
    this.persistence.inFlightTurns.save({ turnId, conversationKey: conversationId, messages: batch });
    this.logger.info(`[chat] sending batch of ${batch.length} message(s) (${reason})`);
    await this.turns.enqueue(conversationId, turnId, toSubmitTurnRequest(turnId, batch, null));
  }

  private appendTurn(conversationKey: string, turn: Omit<TurnView, 'reply'>): void {
    updateThread(conversationKey, (thread) => ({
      ...thread,
      // A new draft has no history to load; an existing conversation keeps 'idle' so its history still loads and merges.
      loadStatus:
        conversationKey === DRAFT_CONVERSATION_KEY && thread.loadStatus === 'idle'
          ? 'ready'
          : thread.loadStatus,
      turns: [...thread.turns, { ...turn, reply: createWaitingReply() }],
    }));
  }

  private failDraftTurn(conversationKey: string, turnId: string, error: unknown): void {
    const key = useChatStore.getState().threads[DRAFT_CONVERSATION_KEY]
      ? DRAFT_CONVERSATION_KEY
      : conversationKey;
    this.persistence.inFlightTurns.remove(turnId);
    updateTurn(key, turnId, (turn) => ({
      ...turn,
      reply: { ...turn.reply, phase: 'error', error: replyErrorFrom(error, Date.now()) },
    }));
    this.schedulers.release(key);
  }

  /** Creates the conversation for the draft view and moves the draft's thread and pending messages over. */
  private materializeDraft(): Promise<string> {
    this.draftCreation ??= this.createConversationFromDraft().finally(() => {
      this.draftCreation = null;
    });
    return this.draftCreation;
  }

  private async createConversationFromDraft(): Promise<string> {
    const conversation = await this.api.createConversation();
    upsertConversation(conversation);
    const { id } = conversation;
    useChatStore.setState((state) => {
      const draft = state.threads[DRAFT_CONVERSATION_KEY];
      const threads = omitKey(state.threads, DRAFT_CONVERSATION_KEY);
      if (draft) threads[id] = draft;
      const isDraftActive = state.activeConversationKey === DRAFT_CONVERSATION_KEY;
      return { threads, activeConversationKey: isDraftActive ? id : state.activeConversationKey };
    });
    if (useChatStore.getState().activeConversationKey === id) {
      this.options.onActiveConversationChange?.(id, 'replace');
    }
    this.schedulers.move(DRAFT_CONVERSATION_KEY, id, { hold: true });
    return id;
  }

  private latestTurn(turnId: string): TurnView | undefined {
    const last = useChatStore.getState().threads[this.activeKey()]?.turns.at(-1);
    return last?.turnId === turnId ? last : undefined;
  }

  private replaceLatestTurn(turn: TurnView, userMessages: UserMessageView[]): void {
    const conversationId = this.activeKey();
    if (conversationId === DRAFT_CONVERSATION_KEY) return;
    this.turns.stop();

    const newTurnId = this.createId();
    // Resent messages get fresh client ids: the server stores them as new messages of the new turn.
    const resent = userMessages.map((m) => ({ ...m, clientMessageId: this.createId(), serverId: null }));
    updateThread(conversationId, (thread) => ({
      ...thread,
      turns: [
        ...thread.turns.filter((t) => t.turnId !== turn.turnId),
        { turnId: newTurnId, userMessages: resent, reply: createWaitingReply() },
      ],
    }));
    this.schedulers.obtain(conversationId).hold();
    void this.turns.enqueue(conversationId, newTurnId, toSubmitTurnRequest(newTurnId, resent, turn.turnId));
  }

  private activeKey(): string {
    return useChatStore.getState().activeConversationKey;
  }
}

function toSubmitTurnRequest(
  turnId: string,
  messages: readonly Pick<PendingUserMessage, 'clientMessageId' | 'content' | 'attachments'>[],
  replacesTurnId: string | null,
): SubmitTurnRequest {
  return {
    turnId,
    replacesTurnId,
    messages: messages.map((m) => ({
      clientMessageId: m.clientMessageId,
      content: m.content,
      attachmentIds: m.attachments.map((a) => a.id),
    })),
  };
}
