/**
 * RFC 9457 "Problem Details for HTTP APIs" body returned for every error response.
 * `requestId` lets a caller hand support an exact log reference.
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  /** Stable, machine-readable error code, e.g. `route_not_found`. */
  readonly code: string;
  readonly requestId?: string;
  /** Field-level validation errors, when applicable. */
  readonly errors?: readonly ProblemFieldError[];
  /** Seconds to wait before retrying; sent with 429 and 503 alongside `Retry-After`. */
  readonly retryAfterSeconds?: number;
  /** Error-specific facts, e.g. `{ existingDocumentId }` for `duplicate_document`. */
  readonly details?: ProblemDetailsMembers;
}

export type ProblemDetailsMembers = Readonly<Record<string, string | number | boolean>>;

export interface ProblemFieldError {
  readonly field: string;
  readonly message: string;
}

export const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';
