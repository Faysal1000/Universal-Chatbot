/**
 * Failure of a call to another service (embedding-server, llm-gateway).
 * `isRetryable` separates transient faults (timeouts, 429, 5xx) from permanent ones
 * (validation errors), so callers and BullMQ retries never repeat a request that
 * cannot succeed.
 */
export class UpstreamServiceError extends Error {
  constructor(
    readonly serviceName: string,
    readonly operation: string,
    message: string,
    readonly details: {
      readonly httpStatus?: number;
      readonly isRetryable: boolean;
      readonly retryAfterSeconds?: number;
      readonly upstreamCode?: string;
    },
  ) {
    super(`${serviceName} ${operation} failed: ${message}`);
    this.name = 'UpstreamServiceError';
  }

  get isRetryable(): boolean {
    return this.details.isRetryable;
  }
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryableHttpStatus(httpStatus: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(httpStatus);
}

/** Parses `Retry-After` given as delta-seconds or an HTTP date; undefined when absent or invalid. */
export function parseRetryAfterSeconds(
  headerValue: string | null,
  now: Date = new Date(),
): number | undefined {
  if (headerValue === null || headerValue.trim() === '') return undefined;
  const trimmedValue = headerValue.trim();
  if (/^\d+$/.test(trimmedValue)) return Number(trimmedValue);
  const retryDate = Date.parse(trimmedValue);
  if (Number.isNaN(retryDate)) return undefined;
  return Math.max(0, Math.ceil((retryDate - now.getTime()) / 1_000));
}
