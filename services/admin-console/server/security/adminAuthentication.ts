/**
 * Session cookie handling and the request guard for every `/api` route: a live session is
 * required, and state-changing requests must come from this origin and carry the session's
 * CSRF token (synchronizer token, on top of the SameSite=Strict cookie).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';

import { PROBLEMS, sendProblem } from '../http/problem.ts';
import type { AdminSession, SessionStore } from './sessionStore.ts';

const CSRF_HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'fastify' {
  interface FastifyRequest {
    adminSession: AdminSession | undefined;
  }
}

export interface SessionCookieSettings {
  readonly secure: boolean;
  readonly maxAgeSeconds: number;
}

/** `__Host-` pins the cookie to this exact origin, but browsers only accept it over HTTPS. */
function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-admin_console_session' : 'admin_console_session';
}

export function setSessionCookie(reply: FastifyReply, sessionId: string, settings: SessionCookieSettings): void {
  void reply.setCookie(sessionCookieName(settings.secure), sessionId, {
    path: '/',
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'strict',
    maxAge: settings.maxAgeSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  void reply.clearCookie(sessionCookieName(secure), { path: '/', httpOnly: true, secure, sameSite: 'strict' });
}

function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method);
}

/**
 * Rejects requests a browser sent from another site. `Sec-Fetch-Site` is authoritative when
 * present; otherwise the `Origin` host must equal the `Host` the browser addressed.
 */
export function isSameOriginRequest(request: FastifyRequest): boolean {
  const fetchSite = request.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string') return fetchSite === 'same-origin' || fetchSite === 'none';
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function hasValidCsrfToken(request: FastifyRequest, session: AdminSession): boolean {
  const providedToken = request.headers[CSRF_HEADER_NAME];
  if (typeof providedToken !== 'string') return false;
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(session.csrfToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function readSessionId(request: FastifyRequest, secure: boolean): string | undefined {
  return request.cookies[sessionCookieName(secure)];
}

/** Fastify `onRequest` hook guarding every authenticated route. */
export function buildAdminGuard(sessions: SessionStore, cookieSecure: boolean) {
  return async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const session = sessions.touch(readSessionId(request, cookieSecure));
    if (session === undefined) {
      await sendProblem(reply, PROBLEMS.notSignedIn);
      return;
    }
    if (!isSafeMethod(request.method) && !(isSameOriginRequest(request) && hasValidCsrfToken(request, session))) {
      await sendProblem(reply, PROBLEMS.csrfRejected);
      return;
    }
    request.adminSession = session;
  };
}
