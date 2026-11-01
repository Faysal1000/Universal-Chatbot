import { describe, expect, it, vi } from 'vitest';

import { MessageBatchScheduler, type FlushReason, type SchedulerClock } from './messageBatchScheduler';

interface TestMessage {
  clientMessageId: string;
  content: string;
}

/** Deterministic clock: timers fire only when `advance` passes their due time. */
class ManualClock implements SchedulerClock {
  private current = 0;
  private nextHandle = 1;
  private timers = new Map<number, { dueAt: number; callback: () => void }>();

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle++;
    this.timers.set(handle, { dueAt: this.current + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.current = due[1].dueAt;
      due[1].callback();
    }
    this.current = target;
  }
}

function message(id: string): TestMessage {
  return { clientMessageId: id, content: `message ${id}` };
}

function createScheduler(
  overrides: { random?: () => number; maxWaitMs?: number; maxBatchSize?: number } = {},
) {
  const clock = new ManualClock();
  const flushes: { batch: TestMessage[]; reason: FlushReason }[] = [];
  const scheduler = new MessageBatchScheduler<TestMessage>({
    quietWindowMinMs: 5000,
    quietWindowMaxMs: 7000,
    maxWaitMs: overrides.maxWaitMs ?? 30_000,
    maxBatchSize: overrides.maxBatchSize ?? 10,
    clock,
    random: overrides.random ?? (() => 0),
    onFlush: (batch, reason) => flushes.push({ batch, reason }),
  });
  return { clock, scheduler, flushes };
}

describe('MessageBatchScheduler', () => {
  it('does not send immediately, then flushes one batch after the quiet window', () => {
    const { clock, scheduler, flushes } = createScheduler();
    scheduler.enqueue(message('a'));

    clock.advance(4999);
    expect(flushes).toHaveLength(0);

    clock.advance(1);
    expect(flushes).toEqual([{ batch: [message('a')], reason: 'quiet_window' }]);
    expect(scheduler.hasPending).toBe(false);
  });

  it('batches messages sent in quick succession into one flush, restarting the window each time', () => {
    const { clock, scheduler, flushes } = createScheduler();
    scheduler.enqueue(message('a'));
    clock.advance(4000);
    scheduler.enqueue(message('b'));
    clock.advance(4000);
    scheduler.enqueue(message('c'));
    clock.advance(4999);
    expect(flushes).toHaveLength(0);

    clock.advance(1);
    expect(flushes).toHaveLength(1);
    expect(flushes[0]?.batch.map((m) => m.clientMessageId)).toEqual(['a', 'b', 'c']);
  });

  it('picks the quiet window inside [min, max] using the random source', () => {
    const { clock, scheduler, flushes } = createScheduler({ random: () => 0.5 });
    scheduler.enqueue(message('a'));
    clock.advance(5999);
    expect(flushes).toHaveLength(0);
    clock.advance(1);
    expect(flushes).toHaveLength(1);
  });

  it('postpones the flush while the user is typing', () => {
    const { clock, scheduler, flushes } = createScheduler();
    scheduler.enqueue(message('a'));
    for (let i = 0; i < 4; i += 1) {
      clock.advance(3000);
      scheduler.noteTyping();
    }
    expect(flushes).toHaveLength(0);
    clock.advance(5000);
    expect(flushes).toHaveLength(1);
  });

  it('ignores typing when nothing is pending', () => {
    const { clock, scheduler, flushes } = createScheduler();
    scheduler.noteTyping();
    clock.advance(60_000);
    expect(flushes).toHaveLength(0);
  });

  it('caps the total wait so continuous typing cannot starve the batch', () => {
    const { clock, scheduler, flushes } = createScheduler({ maxWaitMs: 12_000 });
    scheduler.enqueue(message('a'));
    for (let elapsed = 0; elapsed < 11_000; elapsed += 1000) {
      clock.advance(1000);
      scheduler.noteTyping();
    }
    clock.advance(1000);
    expect(flushes).toEqual([{ batch: [message('a')], reason: 'max_wait' }]);
  });

  it('flushes immediately when the batch reaches the maximum size', () => {
    const { scheduler, flushes } = createScheduler({ maxBatchSize: 3 });
    scheduler.enqueue(message('a'));
    scheduler.enqueue(message('b'));
    expect(flushes).toHaveLength(0);
    scheduler.enqueue(message('c'));
    expect(flushes).toEqual([{ batch: [message('a'), message('b'), message('c')], reason: 'batch_full' }]);
  });

  it('sends at once when the page is hidden', () => {
    const { scheduler, flushes } = createScheduler();
    scheduler.enqueue(message('a'));
    scheduler.flushForHiddenPage();
    expect(flushes).toEqual([{ batch: [message('a')], reason: 'page_hidden' }]);
  });

  it('applies edits to pending messages and restarts the window', () => {
    const { clock, scheduler, flushes } = createScheduler();
    scheduler.enqueue(message('a'));
    clock.advance(4000);
    scheduler.updatePending('a', (m) => ({ ...m, content: 'edited' }));
    clock.advance(4000);
    expect(flushes).toHaveLength(0);
    clock.advance(1000);
    expect(flushes[0]?.batch[0]?.content).toBe('edited');
  });

  it('cancels the flush when the last pending message is removed', () => {
    const { clock, scheduler, flushes } = createScheduler();
    scheduler.enqueue(message('a'));
    expect(scheduler.removePending('a')).toBe(true);
    clock.advance(60_000);
    expect(flushes).toHaveLength(0);
  });

  it('holds messages while a reply streams and starts a fresh window on release', () => {
    const { clock, scheduler, flushes } = createScheduler();
    scheduler.hold();
    scheduler.enqueue(message('a'));
    scheduler.enqueue(message('b'));
    clock.advance(60_000);
    expect(flushes).toHaveLength(0);
    expect(scheduler.snapshot().isHeld).toBe(true);

    scheduler.release();
    clock.advance(4999);
    expect(flushes).toHaveLength(0);
    clock.advance(1);
    expect(flushes[0]?.batch.map((m) => m.clientMessageId)).toEqual(['a', 'b']);
  });

  it('does not flush a full batch while held', () => {
    const { scheduler, flushes } = createScheduler({ maxBatchSize: 2 });
    scheduler.hold();
    scheduler.enqueue(message('a'));
    scheduler.enqueue(message('b'));
    expect(flushes).toHaveLength(0);
  });

  it('keeps messages pending when the page is hidden during a hold', () => {
    const { scheduler, flushes } = createScheduler();
    scheduler.hold();
    scheduler.enqueue(message('a'));
    scheduler.flushForHiddenPage();
    expect(flushes).toHaveLength(0);
    expect(scheduler.hasPending).toBe(true);
  });

  it('restores persisted messages without duplicates and schedules them', () => {
    const { clock, scheduler, flushes } = createScheduler();
    scheduler.enqueue(message('a'));
    scheduler.restore([message('a'), message('b')]);
    clock.advance(5000);
    expect(flushes[0]?.batch.map((m) => m.clientMessageId)).toEqual(['a', 'b']);
  });

  it('notifies listeners with snapshots', () => {
    const onChange = vi.fn();
    const clock = new ManualClock();
    const scheduler = new MessageBatchScheduler<TestMessage>({
      quietWindowMinMs: 5000,
      quietWindowMaxMs: 5000,
      maxWaitMs: 30_000,
      maxBatchSize: 10,
      clock,
      onFlush: () => undefined,
      onChange,
    });
    scheduler.enqueue(message('a'));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ pending: [message('a')], isHeld: false }),
    );
  });

  it('rejects an inverted window configuration', () => {
    expect(
      () =>
        new MessageBatchScheduler({
          quietWindowMinMs: 7000,
          quietWindowMaxMs: 5000,
          maxWaitMs: 30_000,
          maxBatchSize: 10,
          onFlush: () => undefined,
        }),
    ).toThrow(RangeError);
  });
});

describe('MessageBatchScheduler turn limits', () => {
  it('sends restored messages beyond the batch size in the next turn', () => {
    const { scheduler, clock, flushes } = createScheduler({ maxBatchSize: 2 });
    scheduler.restore([message('a'), message('b'), message('c')]);
    clock.advance(5000);
    expect(flushes.map((flush) => flush.batch.map((m) => m.clientMessageId))).toEqual([['a', 'b']]);
    clock.advance(5000);
    expect(flushes.at(-1)?.batch.map((m) => m.clientMessageId)).toEqual(['c']);
  });

  it('stops a batch before the message that would pass the image limit', () => {
    const flushed: string[][] = [];
    const clock = new ManualClock();
    const scheduler = new MessageBatchScheduler<TestMessage & { attachments: unknown[] }>({
      quietWindowMinMs: 1000,
      quietWindowMaxMs: 1000,
      maxWaitMs: 10_000,
      maxBatchSize: 10,
      maxImagesPerBatch: 4,
      clock,
      onFlush: (batch) => flushed.push(batch.map((m) => m.clientMessageId)),
    });
    scheduler.enqueue({ ...message('a'), attachments: [1, 2, 3] });
    scheduler.enqueue({ ...message('b'), attachments: [1, 2] });
    clock.advance(1000);
    expect(flushed).toEqual([['a']]);
  });
});
