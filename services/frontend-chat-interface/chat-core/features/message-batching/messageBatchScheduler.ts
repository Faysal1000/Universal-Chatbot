/**
 * Decides WHEN queued user messages are sent to the model.
 *
 * Users often send several short messages in a row ("hi", "I have a question", "about the refund policy").
 * Answering each one separately wastes tokens and produces several half-answers. The scheduler instead holds
 * messages for a quiet window (randomised in [min, max]) that restarts on every new message, edit or keystroke.
 * When the window expires the whole batch is flushed as ONE turn.
 *
 * Rules:
 * - `maxWaitMs` caps the total delay from the first queued message, so continuous typing cannot starve a batch.
 * - `maxBatchSize` flushes immediately when the batch is full (the backend accepts at most N messages per turn).
 * - While `hold()` is active (a reply is in flight) nothing flushes. `release()` starts a fresh quiet window
 *   for anything still pending, e.g. messages restored after a reload.
 *
 * The class is framework-free and takes an injectable clock + random source so its timing is unit-testable.
 */
export interface SchedulerClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface BatchedMessage {
  clientMessageId: string;
  attachments?: readonly unknown[];
}

export type FlushReason = 'quiet_window' | 'max_wait' | 'batch_full' | 'page_hidden' | 'resumed';

export interface BatchSchedulerSnapshot<Message> {
  pending: readonly Message[];
  /** A reply is in flight, so nothing is sent until it ends. */
  isHeld: boolean;
}

export interface MessageBatchSchedulerOptions<Message extends BatchedMessage> {
  quietWindowMinMs: number;
  quietWindowMaxMs: number;
  maxWaitMs: number;
  maxBatchSize: number;
  /** The backend counts images per turn, so a batch stops before the message that would pass this. */
  maxImagesPerBatch?: number;
  onFlush: (batch: Message[], reason: FlushReason) => void;
  onChange?: (snapshot: BatchSchedulerSnapshot<Message>) => void;
  clock?: SchedulerClock;
  random?: () => number;
}

export class MessageBatchScheduler<Message extends BatchedMessage> {
  private pending: Message[] = [];
  private timer: unknown = null;
  private firstQueuedAt: number | null = null;
  private held = false;
  private readonly clock: SchedulerClock;
  private readonly random: () => number;

  constructor(private readonly options: MessageBatchSchedulerOptions<Message>) {
    if (options.quietWindowMinMs > options.quietWindowMaxMs) {
      throw new RangeError('quietWindowMinMs must not exceed quietWindowMaxMs');
    }
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
  }

  snapshot(): BatchSchedulerSnapshot<Message> {
    return { pending: [...this.pending], isHeld: this.held };
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** Queue a message and restart the quiet window. */
  enqueue(message: Message): void {
    this.pending.push(message);
    this.firstQueuedAt ??= this.clock.now();
    if (this.pending.length >= this.options.maxBatchSize && !this.held) {
      this.flush('batch_full');
      return;
    }
    this.restartWindow();
  }

  /** Re-adds messages restored from storage (e.g. after the tab was closed) without losing their order. */
  restore(messages: readonly Message[]): void {
    if (messages.length === 0) return;
    const known = new Set(this.pending.map((message) => message.clientMessageId));
    this.pending.push(...messages.filter((message) => !known.has(message.clientMessageId)));
    this.firstQueuedAt ??= this.clock.now();
    this.restartWindow();
  }

  /** Edit a still-pending message in place. Counts as activity, so the window restarts. */
  updatePending(clientMessageId: string, update: (message: Message) => Message): boolean {
    const index = this.pending.findIndex((message) => message.clientMessageId === clientMessageId);
    const current = this.pending[index];
    if (current === undefined) return false;
    this.pending[index] = update(current);
    this.restartWindow();
    return true;
  }

  /** Remove a pending message; cancels the timer when the batch becomes empty. */
  removePending(clientMessageId: string): boolean {
    const before = this.pending.length;
    this.pending = this.pending.filter((message) => message.clientMessageId !== clientMessageId);
    if (this.pending.length === before) return false;
    if (this.pending.length === 0) this.reset();
    else this.restartWindow();
    return true;
  }

  /** The user is typing: postpone the flush so their next message joins the batch. */
  noteTyping(): void {
    if (this.pending.length > 0) this.restartWindow();
  }

  /** The page is being hidden: send what is pending now, unless a reply is still in flight. */
  flushForHiddenPage(): void {
    if (this.pending.length > 0 && !this.held) this.flush('page_hidden');
  }

  /** Pause flushing while a reply is in flight. */
  hold(): void {
    if (this.held) return;
    this.held = true;
    this.clearTimer();
    this.emitChange();
  }

  /** Resume after a hold with a fresh quiet window for anything still pending. */
  release(): void {
    if (!this.held) return;
    this.held = false;
    // The cap restarts too: nothing could be sent while the reply was in flight.
    this.firstQueuedAt = this.clock.now();
    this.restartWindow();
  }

  /** Drop everything without flushing (e.g. the conversation was deleted). */
  clear(): void {
    this.pending = [];
    this.reset();
  }

  dispose(): void {
    this.clearTimer();
  }

  private restartWindow(): void {
    this.clearTimer();
    if (this.held || this.pending.length === 0) {
      this.emitChange();
      return;
    }
    const now = this.clock.now();
    const { quietWindowMinMs, quietWindowMaxMs, maxWaitMs } = this.options;
    const quietWindowMs = Math.round(
      quietWindowMinMs + this.random() * (quietWindowMaxMs - quietWindowMinMs),
    );
    const capAt = (this.firstQueuedAt ?? now) + maxWaitMs;
    const flushAt = Math.min(now + quietWindowMs, capAt);
    const reason: FlushReason =
      flushAt === capAt && capAt < now + quietWindowMs ? 'max_wait' : 'quiet_window';

    this.timer = this.clock.setTimeout(
      () => {
        this.timer = null;
        this.flush(reason);
      },
      Math.max(0, flushAt - now),
    );
    this.emitChange();
  }

  /** Sends what fits in one turn; the rest stays pending for the next one. */
  private flush(reason: FlushReason): void {
    const batch = this.pending.splice(0, this.fittingCount());
    if (this.pending.length === 0) this.reset();
    else this.restartWindow();
    if (batch.length > 0) this.options.onFlush(batch, reason);
  }

  private fittingCount(): number {
    const maxImages = this.options.maxImagesPerBatch ?? Infinity;
    let imageCount = 0;
    let count = 0;
    for (const message of this.pending) {
      imageCount += message.attachments?.length ?? 0;
      if (count > 0 && (count >= this.options.maxBatchSize || imageCount > maxImages)) break;
      count += 1;
    }
    return count;
  }

  private reset(): void {
    this.clearTimer();
    this.firstQueuedAt = null;
    this.emitChange();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private emitChange(): void {
    this.options.onChange?.(this.snapshot());
  }
}
