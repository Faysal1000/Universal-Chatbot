import {
  API_ERROR_CODES,
  problemDetailsSchema,
  REQUEST_ID_HEADER,
  type ProblemDetails,
} from './chatApiContract';

export type ChatApiErrorKind =
  | 'rate_limited'
  | 'unavailable'
  | 'too_large'
  | 'unsupported_media'
  | 'session_expired'
  | 'conflict'
  | 'validation'
  | 'not_found'
  | 'network'
  | 'stream_interrupted'
  | 'server';

export interface FieldError {
  field: string;
  message: string;
}

export interface ChatApiErrorDetails {
  status?: number;
  code?: string;
  retryAfterMs?: number;
  retryable?: boolean;
  /** Correlates the failure with server logs; worth showing so users can quote it to support. */
  requestId?: string;
  fieldErrors?: FieldError[];
  cause?: unknown;
}

/** A failed API call, normalised from RFC 9457 problem details, the HTTP status, or a network failure. */
export class ChatApiError extends Error {
  override readonly name = 'ChatApiError';

  constructor(
    readonly kind: ChatApiErrorKind,
    message: string,
    readonly details: ChatApiErrorDetails = {},
  ) {
    super(message, { cause: details.cause });
  }

  get status(): number | undefined {
    return this.details.status;
  }

  get code(): string | undefined {
    return this.details.code;
  }

  get retryAfterMs(): number | undefined {
    return this.details.retryAfterMs;
  }

  get requestId(): string | undefined {
    return this.details.requestId;
  }

  /** Whether retrying the same request later may succeed. */
  get isRetryable(): boolean {
    if (this.details.retryable !== undefined) return this.details.retryable;
    return ['rate_limited', 'unavailable', 'network', 'stream_interrupted'].includes(this.kind);
  }
}

const KIND_BY_STATUS: Record<number, ChatApiErrorKind> = {
  401: 'session_expired',
  404: 'not_found',
  409: 'conflict',
  413: 'too_large',
  415: 'unsupported_media',
  422: 'validation',
  429: 'rate_limited',
  502: 'unavailable',
  503: 'unavailable',
  504: 'unavailable',
};

const KIND_BY_CODE: Record<string, ChatApiErrorKind> = {
  [API_ERROR_CODES.rateLimited]: 'rate_limited',
  [API_ERROR_CODES.serviceUnavailable]: 'unavailable',
  [API_ERROR_CODES.attachmentTooLarge]: 'too_large',
  [API_ERROR_CODES.unsupportedMediaType]: 'unsupported_media',
  [API_ERROR_CODES.sessionExpired]: 'session_expired',
  [API_ERROR_CODES.turnInProgress]: 'conflict',
  [API_ERROR_CODES.turnNotReplaceable]: 'conflict',
  [API_ERROR_CODES.idempotencyConflict]: 'conflict',
  [API_ERROR_CODES.validationFailed]: 'validation',
  [API_ERROR_CODES.notFound]: 'not_found',
};

/** Parses `Retry-After` (delta-seconds or HTTP date) into milliseconds from now. */
export function parseRetryAfterHeader(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function errorKindFromCode(code: string | undefined, status?: number): ChatApiErrorKind {
  if (code && KIND_BY_CODE[code]) return KIND_BY_CODE[code];
  if (status && KIND_BY_STATUS[status]) return KIND_BY_STATUS[status];
  return 'server';
}

export async function chatApiErrorFromResponse(response: Response): Promise<ChatApiError> {
  let problem: ProblemDetails = {};
  try {
    const parsed = problemDetailsSchema.safeParse(await response.json());
    if (parsed.success) problem = parsed.data;
  } catch {
    // Non-JSON error body (e.g. a proxy error page): fall back to the status code.
  }
  const retryAfterMs =
    parseRetryAfterHeader(response.headers.get('Retry-After')) ??
    (problem.retryAfterSeconds === undefined ? undefined : problem.retryAfterSeconds * 1000);
  const requestId = problem.requestId ?? response.headers.get(REQUEST_ID_HEADER) ?? undefined;

  return new ChatApiError(
    errorKindFromCode(problem.code, response.status),
    problem.detail ?? problem.title ?? `Request failed with status ${response.status}`,
    {
      status: response.status,
      ...(problem.code === undefined ? {} : { code: problem.code }),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      ...(requestId === undefined ? {} : { requestId }),
      ...(problem.errors === undefined ? {} : { fieldErrors: problem.errors }),
    },
  );
}
