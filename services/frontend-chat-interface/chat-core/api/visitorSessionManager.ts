import { apiPaths } from './apiPaths';
import { visitorSessionSchema, type VisitorSession } from './chatApiContract';
import { ChatApiError } from './chatApiError';
import { parseJsonResponse, type HttpTransport } from './httpTransport';

export interface VisitorSessionStore {
  load(): VisitorSession | null;
  save(session: VisitorSession): void;
  clear(): void;
}

export interface VisitorSessionManagerOptions {
  transport: HttpTransport;
  store: VisitorSessionStore;
  /** Returns a Turnstile token, or null when the backend does not require one. */
  obtainTurnstileToken: () => Promise<string | null>;
  computeFingerprint: () => Promise<string>;
  /**
   * A previous session expired and a new one replaced it. Conversations belong to a session, so the old ones are
   * no longer visible: the UI should reload its conversation list.
   */
  onSessionReplaced?: () => void;
}

/** Renew a little before the server-side expiry, so requests never race the deadline. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * Owns the anonymous visitor session (Turnstile → signed session token): creates it lazily, shares one in-flight
 * creation between concurrent callers, and exposes authorised requests that renew the session once on 401.
 */
export class VisitorSessionManager {
  private pendingCreation: Promise<VisitorSession> | null = null;
  private hadSession: boolean;

  constructor(private readonly options: VisitorSessionManagerOptions) {
    this.hadSession = options.store.load() !== null;
  }

  async ensureSession(): Promise<VisitorSession> {
    const stored = this.options.store.load();
    if (stored && Date.parse(stored.expiresAt) - EXPIRY_SAFETY_MARGIN_MS > Date.now()) return stored;
    this.pendingCreation ??= this.createSession().finally(() => {
      this.pendingCreation = null;
    });
    return this.pendingCreation;
  }

  /** Sends a request with the visitor bearer token; on `session_expired` renews the session and retries once. */
  async authorizedSend(path: string, init: RequestInit = {}, isRetry = false): Promise<Response> {
    const session = await this.ensureSession();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${session.sessionToken}`);
    try {
      return await this.options.transport.send(path, { ...init, headers });
    } catch (error) {
      if (isRetry || !(error instanceof ChatApiError) || error.kind !== 'session_expired') throw error;
      // A parallel request may have renewed it already; only the session that failed is forgotten.
      if (this.options.store.load()?.sessionToken === session.sessionToken) this.invalidate();
      return this.authorizedSend(path, init, true);
    }
  }

  /** Forgets the current session (e.g. the server reported it expired). */
  invalidate(): void {
    this.options.store.clear();
  }

  private async createSession(): Promise<VisitorSession> {
    const [turnstileToken, fingerprint] = await Promise.all([
      this.options.obtainTurnstileToken(),
      this.options.computeFingerprint(),
    ]);
    const response = await this.options.transport.send(apiPaths.sessions(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken, fingerprint }),
    });
    const session = await parseJsonResponse(response, visitorSessionSchema);
    this.options.store.save(session);
    if (this.hadSession) this.options.onSessionReplaced?.();
    this.hadSession = true;
    return session;
  }
}
