/** `POST /api/session` signs in, `GET` returns the session (and CSRF token), `DELETE` signs out. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { PROBLEMS, sendProblem, tooManyLoginAttempts } from '../http/problem.ts';
import {
  buildAdminGuard,
  clearSessionCookie,
  isSameOriginRequest,
  readSessionId,
  setSessionCookie,
} from '../security/adminAuthentication.ts';
import type { LoginThrottle } from '../security/loginThrottle.ts';
import { verifyPassword } from '../security/passwordHash.ts';
import type { AdminSession, SessionStore } from '../security/sessionStore.ts';

const MAX_CREDENTIAL_LENGTH = 1024;

const loginBodySchema = z.object({
  username: z.string().min(1).max(MAX_CREDENTIAL_LENGTH),
  password: z.string().min(1).max(MAX_CREDENTIAL_LENGTH),
});

export interface SessionRouteOptions {
  readonly sessions: SessionStore;
  readonly loginThrottle: LoginThrottle;
  readonly admin: { username: string; passwordHash: string };
  readonly cookie: { secure: boolean; maxAgeSeconds: number };
}

interface SessionResponse {
  username: string;
  csrfToken: string;
  expiresAt: string;
}

function toSessionResponse(session: AdminSession): SessionResponse {
  return {
    username: session.username,
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAtMilliseconds).toISOString(),
  };
}

/** Routes behind the admin guard always have a session; this makes that explicit. */
function sessionOf(request: FastifyRequest): AdminSession {
  if (request.adminSession === undefined) throw new Error('admin guard did not run');
  return request.adminSession;
}

function usernameMatches(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export function registerSessionRoutes(app: FastifyInstance, options: SessionRouteOptions): void {
  const { sessions, loginThrottle, admin, cookie } = options;
  const requireAdmin = buildAdminGuard(sessions, cookie.secure);

  app.post('/api/session', async (request, reply) => {
    if (!isSameOriginRequest(request)) return sendProblem(reply, PROBLEMS.csrfRejected);
    const retryAfterSeconds = loginThrottle.retryAfterSeconds(request.ip);
    if (retryAfterSeconds > 0) {
      void reply.header('retry-after', String(retryAfterSeconds));
      return sendProblem(reply, tooManyLoginAttempts(retryAfterSeconds));
    }
    const credentials = loginBodySchema.safeParse(request.body);
    // scrypt always runs, so the response time does not reveal whether the username was right.
    const passwordMatches = await verifyPassword(credentials.data?.password ?? '', admin.passwordHash);
    if (!credentials.success || !passwordMatches || !usernameMatches(credentials.data.username, admin.username)) {
      loginThrottle.recordFailure(request.ip);
      request.log.warn({ clientAddress: request.ip }, 'admin sign-in failed');
      return sendProblem(reply, PROBLEMS.invalidCredentials);
    }
    loginThrottle.reset(request.ip);
    const previousSessionId = readSessionId(request, cookie.secure);
    if (previousSessionId !== undefined) sessions.delete(previousSessionId);
    const session = sessions.create(admin.username);
    setSessionCookie(reply, session.id, cookie);
    request.log.info({ username: session.username }, 'admin signed in');
    return toSessionResponse(session);
  });

  app.get('/api/session', { onRequest: requireAdmin }, (request) => {
    return toSessionResponse(sessionOf(request));
  });

  app.delete('/api/session', { onRequest: requireAdmin }, async (request, reply) => {
    sessions.delete(sessionOf(request).id);
    clearSessionCookie(reply, cookie.secure);
    return reply.code(204).send();
  });
}
