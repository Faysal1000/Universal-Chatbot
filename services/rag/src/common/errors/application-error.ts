import type { ProblemDetailsMembers, ProblemFieldError } from './problem-details.js';

/**
 * Base class for expected, client-facing errors. Anything else that reaches the
 * exception filter is treated as an unexpected 500 and logged with its stack.
 */
export class ApplicationError extends Error {
  readonly fieldErrors: readonly ProblemFieldError[] | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly details: ProblemDetailsMembers | undefined;

  constructor(
    readonly httpStatus: number,
    readonly code: string,
    readonly clientMessage: string,
    options: ApplicationErrorOptions = {},
  ) {
    super(clientMessage);
    this.name = new.target.name;
    this.fieldErrors = options.fieldErrors;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}

export interface ApplicationErrorOptions {
  readonly fieldErrors?: readonly ProblemFieldError[];
  readonly retryAfterSeconds?: number;
  /** Machine-readable facts about the error, sent as `details`, e.g. the document a duplicate upload matches. */
  readonly details?: ProblemDetailsMembers;
}
