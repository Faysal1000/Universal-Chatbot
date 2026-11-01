import { visitorSessionSchema, type VisitorSession } from './chatApiContract';
import type { VisitorSessionStore } from './visitorSessionManager';

/**
 * Persists the anonymous visitor session in localStorage so history survives reloads (30-day backend TTL).
 * `keyPrefix` keeps embeddings that share an origin (the chat app, a website widget) on separate sessions.
 * Where storage is blocked (sandboxed iframes, blocked cookies) the session lives in memory for this page.
 */
export function createLocalVisitorSessionStore(keyPrefix: string): VisitorSessionStore {
  const storageKey = `${keyPrefix}.visitorSession.v1`;
  let memorySession: VisitorSession | null = null;
  return {
    load(): VisitorSession | null {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return memorySession;
        const parsed = visitorSessionSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return memorySession;
      }
    },
    save(session) {
      memorySession = session;
      try {
        localStorage.setItem(storageKey, JSON.stringify(session));
      } catch {
        // Kept in memory only.
      }
    },
    clear() {
      memorySession = null;
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Nothing was stored.
      }
    },
  };
}
