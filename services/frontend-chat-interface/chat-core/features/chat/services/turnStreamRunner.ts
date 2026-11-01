import type { ChatApiClient, StreamTurnHandlers } from '@chat-core/api/chatApiClient';
import type { SubmitTurnRequest, TurnStreamEvent } from '@chat-core/api/chatApiContract';
import { ChatApiError } from '@chat-core/api/chatApiError';
import type { InFlightTurnStorage } from '@chat-core/features/message-batching/inFlightTurnStorage';

import { findTurn, updateThread, updateTurn, upsertConversation, useChatStore } from '../chatStore';
import {
  applyStreamEventToTurn,
  isReplyInFlight,
  localReplyError,
  mergeSupersededTurn,
  replyErrorFrom,
  type AssistantReplyView,
} from '../chatThreadModel';

type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

export interface TurnStreamRunnerOptions {
  api: ChatApiClient;
  inFlightTurns: InFlightTurnStorage;
  logger: Logger;
  /** Requests killed by a page unload must not settle (and forget) their in-flight records. */
  isPageUnloading: () => boolean;
  /** No reply is queued or streaming in the conversation any more: its held batch may be sent. */
  onConversationIdle: (conversationId: string) => void;
}

interface ActiveStream {
  conversationId: string;
  turnId: string;
  abort: AbortController;
}

/**
 * Streams assistant replies strictly one at a time (the backend allows one running turn per conversation and the
 * UI shows one at a time) and reduces their events into the store. Also follows `turn.superseded` to the turn
 * that took over the messages.
 */
export class TurnStreamRunner {
  private lane: Promise<void> = Promise.resolve();
  private active: ActiveStream | null = null;
  /** Turns queued or streaming, per conversation; the conversation is idle when this drops to zero. */
  private readonly queuedTurns = new Map<string, number>();

  constructor(private readonly options: TurnStreamRunnerOptions) {}

  get activeStream(): Readonly<Omit<ActiveStream, 'abort'>> | null {
    return this.active;
  }

  /**
   * Queues a turn: `request` submits it, `null` re-attaches to a turn that may still be generating server-side.
   * The returned promise settles when this turn's stream has ended.
   */
  enqueue(conversationId: string, turnId: string, request: SubmitTurnRequest | null): Promise<void> {
    this.queuedTurns.set(conversationId, (this.queuedTurns.get(conversationId) ?? 0) + 1);
    const run = this.lane
      .then(() => this.run(conversationId, turnId, request))
      .finally(() => {
        const remaining = (this.queuedTurns.get(conversationId) ?? 1) - 1;
        if (remaining > 0) {
          this.queuedTurns.set(conversationId, remaining);
          return;
        }
        this.queuedTurns.delete(conversationId);
        this.options.onConversationIdle(conversationId);
      });
    this.lane = run.catch(() => undefined);
    return run;
  }

  /** Stops the streaming reply. The partial answer is kept and marked as stopped. */
  stop(): void {
    const stream = this.active;
    if (!stream) return;
    stream.abort.abort();
    void this.options.api.cancelTurn(stream.conversationId, stream.turnId).catch((error: unknown) => {
      this.options.logger.warn('[chat] cancel request failed', error);
    });
  }

  dispose(): void {
    this.active?.abort.abort();
  }

  private async run(
    conversationId: string,
    turnId: string,
    request: SubmitTurnRequest | null,
  ): Promise<void> {
    const turn = findTurn(conversationId, turnId);
    // Deleted or stopped while queued (or while its conversation was being created): nothing to resend later.
    if (!turn || !isReplyInFlight(turn.reply)) {
      this.options.inFlightTurns.remove(turnId);
      return;
    }

    const abort = new AbortController();
    this.active = { conversationId, turnId, abort };
    useChatStore.setState({ streamingTurn: { conversationKey: conversationId, turnId } });
    const outcome: { supersededBy: string | null } = { supersededBy: null };
    const patchReply = (patch: Partial<AssistantReplyView>) =>
      updateTurn(conversationId, turnId, (t) => ({ ...t, reply: { ...t.reply, ...patch } }));

    const handlers: StreamTurnHandlers = {
      onEvent: (event: TurnStreamEvent) => {
        if (event.type === 'message.started') this.options.inFlightTurns.remove(turnId);
        if (event.type === 'conversation.updated') upsertConversation(event.data.conversation);
        if (event.type === 'turn.superseded') outcome.supersededBy = event.data.supersededByTurnId;
        updateTurn(conversationId, turnId, (current) => applyStreamEventToTurn(current, event, Date.now()));
      },
      onReconnecting: () => patchReply({ isReconnecting: true }),
      onReconnected: () => patchReply({ isReconnecting: false }),
      onInvalidEvent: (name, reason) => this.options.logger.warn(`[chat] invalid "${name}" event`, reason),
    };

    try {
      if (request) await this.options.api.streamTurn(conversationId, request, handlers, abort.signal);
      else await this.options.api.resumeTurnStream(conversationId, turnId, handlers, abort.signal);
    } catch (error) {
      if (abort.signal.aborted) {
        updateTurn(conversationId, turnId, (t) =>
          isReplyInFlight(t.reply)
            ? {
                ...t,
                reply: {
                  ...t.reply,
                  phase: 'stopped',
                  stage: null,
                  finishReason: 'cancelled',
                  isReconnecting: false,
                },
              }
            : t,
        );
      } else if (!request && error instanceof ChatApiError && error.kind === 'not_found') {
        // The resume buffer expired: show the stored state instead.
        patchReply({ phase: 'error', error: localReplyError('not_found', 'This reply was interrupted.') });
      } else {
        this.options.logger.warn('[chat] turn failed', error);
        patchReply({
          phase: 'error',
          stage: null,
          isReconnecting: false,
          error: replyErrorFrom(error, Date.now()),
        });
      }
    } finally {
      // Any outcome other than a page unload settles the turn; retries go through the UI with a new turn id.
      if (!this.options.isPageUnloading()) this.options.inFlightTurns.remove(turnId);
      this.active = null;
      useChatStore.setState({ streamingTurn: null });
    }

    if (outcome.supersededBy) this.followSupersedingTurn(conversationId, turnId, outcome.supersededBy);
  }

  /** The server moved this turn's messages into a newer one: show them there and stream that turn instead. */
  private followSupersedingTurn(
    conversationId: string,
    supersededTurnId: string,
    supersedingTurnId: string,
  ): void {
    this.options.logger.info(`[chat] turn ${supersededTurnId} superseded by ${supersedingTurnId}`);
    const turns = useChatStore.getState().threads[conversationId]?.turns ?? [];
    const merged = mergeSupersededTurn(turns, supersededTurnId, supersedingTurnId);
    updateThread(conversationId, (thread) => ({ ...thread, turns: merged.turns }));
    // A known superseding turn is already queued in this lane; an unknown one (sent from another tab) is followed.
    if (!merged.supersedingTurnIsKnown) void this.enqueue(conversationId, supersedingTurnId, null);
  }
}
