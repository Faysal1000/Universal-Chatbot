/**
 * Server-side admin sessions held in memory. The cookie carries only a random 256-bit id;
 * sign-out deletes the session, so a stolen cookie stops working at once. A restart signs
 * everyone out, which is acceptable for a single-replica admin console.
 */
import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

export interface AdminSession {
  readonly id: string;
  readonly username: string;
  readonly csrfToken: string;
  readonly createdAtMilliseconds: number;
  readonly expiresAtMilliseconds: number;
  lastSeenAtMilliseconds: number;
}

export interface SessionLifetime {
  readonly ttlSeconds: number;
  readonly idleTimeoutSeconds: number;
}

export type Clock = () => number;

function randomToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export class SessionStore {
  readonly #sessions = new Map<string, AdminSession>();
  readonly #lifetime: SessionLifetime;
  readonly #now: Clock;

  constructor(lifetime: SessionLifetime, now: Clock = Date.now) {
    this.#lifetime = lifetime;
    this.#now = now;
  }

  create(username: string): AdminSession {
    this.#deleteExpired();
    const createdAtMilliseconds = this.#now();
    const session: AdminSession = {
      id: randomToken(),
      username,
      csrfToken: randomToken(),
      createdAtMilliseconds,
      expiresAtMilliseconds: createdAtMilliseconds + this.#lifetime.ttlSeconds * 1000,
      lastSeenAtMilliseconds: createdAtMilliseconds,
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  /** Returns the live session and refreshes its idle timer, or undefined when absent or expired. */
  touch(sessionId: string | undefined): AdminSession | undefined {
    if (sessionId === undefined) return undefined;
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return undefined;
    if (this.#isExpired(session)) {
      this.#sessions.delete(sessionId);
      return undefined;
    }
    session.lastSeenAtMilliseconds = this.#now();
    return session;
  }

  delete(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  get size(): number {
    return this.#sessions.size;
  }

  #isExpired(session: AdminSession): boolean {
    const now = this.#now();
    const idleDeadline = session.lastSeenAtMilliseconds + this.#lifetime.idleTimeoutSeconds * 1000;
    return now >= session.expiresAtMilliseconds || now >= idleDeadline;
  }

  #deleteExpired(): void {
    for (const [sessionId, session] of this.#sessions) {
      if (this.#isExpired(session)) this.#sessions.delete(sessionId);
    }
  }
}
