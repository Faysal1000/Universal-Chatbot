import type { NextFunction, Request, Response } from 'express';

const ALLOWED_REQUEST_HEADERS = [
  'Authorization',
  'Content-Type',
  'Idempotency-Key',
  'Last-Event-ID',
  'X-Request-ID',
  'X-Widget-Key',
];
const EXPOSED_RESPONSE_HEADERS = ['Retry-After', 'X-Request-ID', 'X-Trace-ID'];
const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'];
const PREFLIGHT_CACHE_SECONDS = 600;

/** Decides whether a page on this origin may call the public API from the browser. */
export type PublicOriginCheck = (origin: string) => Promise<boolean>;

/**
 * CORS for the public chat API only: the chat app and the website widget run on other origins.
 * The admin API stays same-origin (its cookie is SameSite=Strict anyway). An origin check that fails
 * (the database is unreachable) answers without CORS headers, so the browser blocks the call.
 */
export function createPublicCorsMiddleware(
  isOriginAllowed: PublicOriginCheck,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const origin = request.headers.origin;
    response.vary('Origin');
    void allowedOrNot(isOriginAllowed, origin).then((isAllowed) => {
      if (isAllowed && origin !== undefined) setCorsHeaders(request, response, origin);
      if (request.method === 'OPTIONS') {
        response.status(204).end();
        return;
      }
      next();
    });
  };
}

async function allowedOrNot(
  isOriginAllowed: PublicOriginCheck,
  origin: string | undefined,
): Promise<boolean> {
  if (origin === undefined) return false;
  try {
    return await isOriginAllowed(origin);
  } catch {
    return false;
  }
}

function setCorsHeaders(request: Request, response: Response, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Expose-Headers', EXPOSED_RESPONSE_HEADERS.join(', '));
  if (request.method !== 'OPTIONS') return;
  response.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
  response.setHeader('Access-Control-Allow-Headers', ALLOWED_REQUEST_HEADERS.join(', '));
  response.setHeader('Access-Control-Max-Age', String(PREFLIGHT_CACHE_SECONDS));
}
