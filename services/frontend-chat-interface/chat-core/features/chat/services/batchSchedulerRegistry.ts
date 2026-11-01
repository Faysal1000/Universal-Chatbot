import { DEFAULT_IMAGE_LIMITS } from '@chat-core/features/attachments/imageAttachmentValidation';
import type { BatchingConfig } from '@chat-core/features/message-batching/chatPersistence';
import {
  MessageBatchScheduler,
  type FlushReason,
  type SchedulerClock,
} from '@chat-core/features/message-batching/messageBatchScheduler';
import type { PendingBatchStorage } from '@chat-core/features/message-batching/pendingBatchStorage';
import { omitKey } from '@chat-core/shared/omitKey';

import { useChatStore } from '../chatStore';
import { isReplyInFlight, type PendingUserMessage } from '../chatThreadModel';

const DEFAULT_MAX_MESSAGES_PER_TURN = 10;

export interface BatchSchedulerRegistryOptions {
  batching: BatchingConfig;
  pendingBatches: PendingBatchStorage;
  clock?: SchedulerClock;
  onFlush: (conversationKey: string, batch: PendingUserMessage[], reason: FlushReason) => void;
}

/**
 * One message batch scheduler per conversation, created on demand. Mirrors every scheduler's state into the
 * store (for the pending indicator) and into localStorage (so a closed tab does not lose unsent messages).
 */
export class BatchSchedulerRegistry {
  private readonly schedulers = new Map<string, MessageBatchScheduler<PendingUserMessage>>();

  constructor(private readonly options: BatchSchedulerRegistryOptions) {}

  get(conversationKey: string): MessageBatchScheduler<PendingUserMessage> | undefined {
    return this.schedulers.get(conversationKey);
  }

  /** Returns the conversation's scheduler, creating it (held, if a reply is still streaming there). */
  obtain(conversationKey: string): MessageBatchScheduler<PendingUserMessage> {
    const existing = this.schedulers.get(conversationKey);
    if (existing) return existing;

    const scheduler = new MessageBatchScheduler<PendingUserMessage>({
      quietWindowMinMs: this.options.batching.quietWindowMinMs,
      quietWindowMaxMs: this.options.batching.quietWindowMaxMs,
      maxWaitMs: this.options.batching.maxWaitMs,
      maxBatchSize:
        useChatStore.getState().config?.limits.maxMessagesPerTurn ?? DEFAULT_MAX_MESSAGES_PER_TURN,
      maxImagesPerBatch:
        useChatStore.getState().config?.limits.maxImagesPerTurn ?? DEFAULT_IMAGE_LIMITS.maxImagesPerTurn,
      ...(this.options.clock ? { clock: this.options.clock } : {}),
      onChange: (snapshot) => {
        useChatStore.setState((state) => ({ batches: { ...state.batches, [conversationKey]: snapshot } }));
        this.options.pendingBatches.save(conversationKey, snapshot.pending);
      },
      onFlush: (batch, reason) => this.options.onFlush(conversationKey, batch, reason),
    });
    if (hasReplyInFlight(conversationKey)) scheduler.hold();
    this.schedulers.set(conversationKey, scheduler);
    return scheduler;
  }

  release(conversationKey: string): void {
    this.schedulers.get(conversationKey)?.release();
  }

  /** The tab was hidden: send everything now, so the answers are ready when the user returns. */
  flushAllForHiddenPage(): void {
    for (const scheduler of this.schedulers.values()) scheduler.flushForHiddenPage();
  }

  /** Removes a conversation's scheduler and returns the messages it was still holding back. */
  remove(conversationKey: string): PendingUserMessage[] {
    const scheduler = this.schedulers.get(conversationKey);
    if (!scheduler) return [];
    const pending = [...scheduler.snapshot().pending];
    scheduler.clear();
    scheduler.dispose();
    this.schedulers.delete(conversationKey);
    useChatStore.setState((state) => ({ batches: omitKey(state.batches, conversationKey) }));
    return pending;
  }

  /** Moves pending messages to another conversation (draft → created conversation, or after a session reset). */
  move(fromKey: string, toKey: string, options: { hold: boolean }): void {
    const carriedOver = this.remove(fromKey);
    const target = this.obtain(toKey);
    if (options.hold) target.hold();
    target.restore(carriedOver);
  }

  dispose(): void {
    for (const scheduler of this.schedulers.values()) scheduler.dispose();
    this.schedulers.clear();
  }
}

function hasReplyInFlight(conversationKey: string): boolean {
  return (useChatStore.getState().threads[conversationKey]?.turns ?? []).some((t) =>
    isReplyInFlight(t.reply),
  );
}
