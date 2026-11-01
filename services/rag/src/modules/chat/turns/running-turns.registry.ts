import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

import type { TurnInterruption } from './turn-interruption.js';

/** A connection dropped this long ago with nobody resuming abandons the turn. */
const DISCONNECT_GRACE_MILLISECONDS = 30_000;

interface RunningTurn {
  readonly abortController: AbortController;
  connectedReaders: number;
  abandonTimer: NodeJS.Timeout | undefined;
}

/**
 * Turns generating in this process: their abort handles and how many SSE clients follow
 * them. Generation outlives a dropped connection for a grace period so a client can
 * resume; after that, nobody is listening and the model call is stopped.
 */
@Injectable()
export class RunningTurnsRegistry implements OnApplicationShutdown {
  private readonly runningTurns = new Map<string, RunningTurn>();

  register(turnId: string): AbortSignal {
    const abortController = new AbortController();
    this.runningTurns.set(turnId, { abortController, connectedReaders: 0, abandonTimer: undefined });
    this.scheduleAbandonment(turnId);
    return abortController.signal;
  }

  unregister(turnId: string): void {
    const runningTurn = this.runningTurns.get(turnId);
    clearTimeout(runningTurn?.abandonTimer);
    this.runningTurns.delete(turnId);
  }

  /** Interrupts a turn running here; false when it runs in another process (or not at all). */
  interrupt(turnId: string, interruption: TurnInterruption): boolean {
    const runningTurn = this.runningTurns.get(turnId);
    if (runningTurn === undefined) return false;
    runningTurn.abortController.abort(interruption);
    return true;
  }

  readerConnected(turnId: string): void {
    const runningTurn = this.runningTurns.get(turnId);
    if (runningTurn === undefined) return;
    runningTurn.connectedReaders += 1;
    clearTimeout(runningTurn.abandonTimer);
    runningTurn.abandonTimer = undefined;
  }

  readerDisconnected(turnId: string): void {
    const runningTurn = this.runningTurns.get(turnId);
    if (runningTurn === undefined) return;
    runningTurn.connectedReaders = Math.max(0, runningTurn.connectedReaders - 1);
    if (runningTurn.connectedReaders === 0) this.scheduleAbandonment(turnId);
  }

  onApplicationShutdown(): void {
    for (const turnId of this.runningTurns.keys()) this.interrupt(turnId, { kind: 'abandoned' });
  }

  private scheduleAbandonment(turnId: string): void {
    const runningTurn = this.runningTurns.get(turnId);
    if (runningTurn === undefined) return;
    clearTimeout(runningTurn.abandonTimer);
    runningTurn.abandonTimer = setTimeout(() => {
      this.interrupt(turnId, { kind: 'abandoned' });
    }, DISCONNECT_GRACE_MILLISECONDS);
  }
}
