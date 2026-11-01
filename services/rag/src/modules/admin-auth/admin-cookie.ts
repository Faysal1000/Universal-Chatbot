import { parseCookie, stringifySetCookie } from 'cookie';
import type { Request, Response } from 'express';

const ADMIN_SESSION_COOKIE_NAME = 'rag_admin_session';
export const CSRF_HEADER_NAME = 'x-csrf-token';
/** The cookie is only ever sent to the admin API, never to the public chat routes. */
const ADMIN_COOKIE_PATH = '/v1/admin';

export function readSessionCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (cookieHeader === undefined) return undefined;
  return parseCookie(cookieHeader)[ADMIN_SESSION_COOKIE_NAME];
}

export function writeSessionCookie(
  response: Response,
  sessionToken: string,
  expiresAt: Date,
  isSecure: boolean,
): void {
  appendSessionCookie(response, sessionToken, expiresAt, isSecure);
}

export function clearSessionCookie(response: Response, isSecure: boolean): void {
  appendSessionCookie(response, '', new Date(0), isSecure);
}

function appendSessionCookie(response: Response, value: string, expiresAt: Date, isSecure: boolean): void {
  response.append(
    'Set-Cookie',
    stringifySetCookie({
      name: ADMIN_SESSION_COOKIE_NAME,
      value,
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      path: ADMIN_COOKIE_PATH,
      expires: expiresAt,
    }),
  );
}
