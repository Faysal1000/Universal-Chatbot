/**
 * Sliding one-minute window of failed sign-ins per client address. Once a client reaches the
 * limit it is refused until its oldest failure leaves the window.
 */
import type { Clock } from './sessionStore.ts';

const WINDOW_MILLISECONDS = 60_000;

export class LoginThrottle {
  readonly #failuresByClient = new Map<string, number[]>();
  readonly #maxFailuresPerMinute: number;
  readonly #now: Clock;

  constructor(maxFailuresPerMinute: number, now: Clock = Date.now) {
    this.#maxFailuresPerMinute = maxFailuresPerMinute;
    this.#now = now;
  }

  /** Seconds until the client may try again, or 0 when it is not blocked. */
  retryAfterSeconds(clientAddress: string): number {
    const recentFailures = this.#recentFailures(clientAddress);
    if (recentFailures.length < this.#maxFailuresPerMinute) return 0;
    const oldestFailure = recentFailures[0] ?? this.#now();
    return Math.max(1, Math.ceil((oldestFailure + WINDOW_MILLISECONDS - this.#now()) / 1000));
  }

  recordFailure(clientAddress: string): void {
    this.#failuresByClient.set(clientAddress, [...this.#recentFailures(clientAddress), this.#now()]);
  }

  reset(clientAddress: string): void {
    this.#failuresByClient.delete(clientAddress);
  }

  #recentFailures(clientAddress: string): number[] {
    const windowStart = this.#now() - WINDOW_MILLISECONDS;
    const recentFailures = (this.#failuresByClient.get(clientAddress) ?? []).filter(
      (failedAt) => failedAt > windowStart,
    );
    if (recentFailures.length === 0) this.#failuresByClient.delete(clientAddress);
    return recentFailures;
  }
}
