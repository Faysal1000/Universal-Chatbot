import { setTimeout as sleep } from 'node:timers/promises';

import { UpstreamServiceError } from './upstream-service-error.js';

export interface RetryPolicy {
  readonly maximumAttempts: number;
  readonly initialDelayMilliseconds: number;
  readonly maximumDelayMilliseconds: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maximumAttempts: 3,
  initialDelayMilliseconds: 250,
  maximumDelayMilliseconds: 10_000,
};

/**
 * Runs `operation` until it succeeds, fails permanently, or the attempts run out.
 * Only retryable {@link UpstreamServiceError}s are retried. The delay is exponential
 * with full jitter, but a server's `Retry-After` takes precedence (capped by the policy).
 */
export async function retryWithBackoff<Result>(
  operation: (attemptNumber: number) => Promise<Result>,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
  abortSignal?: AbortSignal,
): Promise<Result> {
  for (let attemptNumber = 1; ; attemptNumber += 1) {
    try {
      return await operation(attemptNumber);
    } catch (error: unknown) {
      if (!shouldRetry(error, attemptNumber, retryPolicy, abortSignal)) throw error;
      await sleep(computeRetryDelayMilliseconds(error, attemptNumber, retryPolicy), undefined, {
        signal: abortSignal,
      });
    }
  }
}

function shouldRetry(
  error: unknown,
  attemptNumber: number,
  retryPolicy: RetryPolicy,
  abortSignal: AbortSignal | undefined,
): error is UpstreamServiceError {
  return (
    error instanceof UpstreamServiceError &&
    error.isRetryable &&
    attemptNumber < retryPolicy.maximumAttempts &&
    abortSignal?.aborted !== true
  );
}

export function computeRetryDelayMilliseconds(
  error: UpstreamServiceError,
  attemptNumber: number,
  retryPolicy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const retryAfterSeconds = error.details.retryAfterSeconds;
  if (retryAfterSeconds !== undefined) {
    return Math.min(retryAfterSeconds * 1_000, retryPolicy.maximumDelayMilliseconds);
  }
  const exponentialDelay = retryPolicy.initialDelayMilliseconds * 2 ** (attemptNumber - 1);
  return Math.floor(random() * Math.min(exponentialDelay, retryPolicy.maximumDelayMilliseconds));
}
