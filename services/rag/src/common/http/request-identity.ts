import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'X-Request-ID';

/** Accept caller IDs only if they are short and log-safe (no spaces, quotes or control chars). */
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Returns the caller's `X-Request-ID` if it is safe to log, otherwise a fresh UUID. */
export function resolveRequestId(incomingRequest: IncomingMessage): string {
  const headerValue = incomingRequest.headers[REQUEST_ID_HEADER.toLowerCase()];
  const candidateRequestId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return candidateRequestId !== undefined && SAFE_REQUEST_ID_PATTERN.test(candidateRequestId)
    ? candidateRequestId
    : randomUUID();
}

/** Request ID assigned by pino-http's `genReqId` (set on every request before routing). */
export function requestIdOf(incomingRequest: IncomingMessage): string | undefined {
  const assignedId = (incomingRequest as IncomingMessage & { id?: unknown }).id;
  return typeof assignedId === 'string' ? assignedId : undefined;
}
