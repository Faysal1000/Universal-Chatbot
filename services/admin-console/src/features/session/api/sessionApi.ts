import { ApiError, requestConsoleApi, setCsrfToken } from '@/shared/api/httpClient';

import type { LoginRequest, SessionResponse } from './sessionTypes';

function rememberSession(session: SessionResponse): SessionResponse {
  setCsrfToken(session.csrfToken);
  return session;
}

/** Returns the signed-in admin, or `null` when there is no valid session. */
export async function fetchCurrentSession(): Promise<SessionResponse | null> {
  try {
    return rememberSession(
      await requestConsoleApi<SessionResponse>('/session', { suppressUnauthorizedRedirect: true }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) return null;
    throw error;
  }
}

export async function signIn(credentials: LoginRequest): Promise<SessionResponse> {
  return rememberSession(
    await requestConsoleApi<SessionResponse>('/session', {
      method: 'POST',
      body: credentials,
      suppressUnauthorizedRedirect: true,
    }),
  );
}

export async function signOut(): Promise<void> {
  try {
    await requestConsoleApi<undefined>('/session', { method: 'DELETE', suppressUnauthorizedRedirect: true });
  } finally {
    setCsrfToken(null);
  }
}
