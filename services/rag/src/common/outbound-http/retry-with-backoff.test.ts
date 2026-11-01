import { describe, expect, it, vi } from 'vitest';

import { computeRetryDelayMilliseconds, retryWithBackoff } from './retry-with-backoff.js';
import { parseRetryAfterSeconds, UpstreamServiceError } from './upstream-service-error.js';

const FAST_POLICY = { maximumAttempts: 3, initialDelayMilliseconds: 1, maximumDelayMilliseconds: 5 };

const transientError = () =>
  new UpstreamServiceError('test', 'call', 'busy', { isRetryable: true, httpStatus: 503 });
const permanentError = () =>
  new UpstreamServiceError('test', 'call', 'bad', { isRetryable: false, httpStatus: 422 });

describe('retryWithBackoff', () => {
  it('retries transient failures until the operation succeeds', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(transientError())
      .mockResolvedValueOnce('ok');

    await expect(retryWithBackoff(operation, FAST_POLICY)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('never retries a permanent failure', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(permanentError());

    await expect(retryWithBackoff(operation, FAST_POLICY)).rejects.toThrow('bad');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('gives up after the maximum number of attempts', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(transientError());

    await expect(retryWithBackoff(operation, FAST_POLICY)).rejects.toThrow('busy');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('prefers Retry-After over exponential backoff, capped by the policy', () => {
    const throttled = new UpstreamServiceError('test', 'call', 'slow down', {
      isRetryable: true,
      retryAfterSeconds: 60,
    });

    expect(
      computeRetryDelayMilliseconds(throttled, 1, { ...FAST_POLICY, maximumDelayMilliseconds: 2_000 }),
    ).toBe(2_000);
  });

  it('uses full jitter below the exponential ceiling', () => {
    const policy = { maximumAttempts: 5, initialDelayMilliseconds: 100, maximumDelayMilliseconds: 10_000 };

    expect(computeRetryDelayMilliseconds(transientError(), 3, policy, () => 0.5)).toBe(200);
  });
});

describe('parseRetryAfterSeconds', () => {
  it.each([
    ['120', 120],
    ['  7 ', 7],
    ['', undefined],
    ['soon', undefined],
  ])('parses %j as %j', (headerValue, expectedSeconds) => {
    expect(parseRetryAfterSeconds(headerValue)).toBe(expectedSeconds);
  });

  it('converts an HTTP date into seconds from now', () => {
    const now = new Date('2026-10-30T10:00:00Z');

    expect(parseRetryAfterSeconds('Fri, 30 Oct 2026 10:00:30 GMT', now)).toBe(30);
  });
});
