import { afterEach, describe, expect, it, vi } from 'vitest';

import { validTestEnvironment } from '../../../test/support/test-environment.js';
import { parseConfiguration } from '../../config/configuration.js';
import { TurnstileAdapter } from './turnstile.adapter.js';

const configuredTurnstile = {
  RAG_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  RAG_TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
};

function adapter(overrides: Record<string, string> = {}): TurnstileAdapter {
  return new TurnstileAdapter(parseConfiguration(validTestEnvironment(overrides)));
}

function siteverifyAnswering(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('TurnstileAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('admits every visitor and publishes no site key when Turnstile is not configured', async () => {
    const fetchMock = siteverifyAnswering({ success: false });
    const unconfigured = adapter();

    expect(unconfigured.siteKey).toBeNull();
    await expect(unconfigured.verify('any-token', '203.0.113.7')).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the token, secret and visitor address to siteverify', async () => {
    const fetchMock = siteverifyAnswering({ success: true });

    await expect(adapter(configuredTurnstile).verify('challenge-token', '203.0.113.7')).resolves.toBe(true);

    const form = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      secret: configuredTurnstile.RAG_TURNSTILE_SECRET_KEY,
      response: 'challenge-token',
      remoteip: '203.0.113.7',
    });
  });

  it('rejects a token Cloudflare does not accept', async () => {
    siteverifyAnswering({ success: false, 'error-codes': ['invalid-input-response'] });

    await expect(adapter(configuredTurnstile).verify('bad-token', '203.0.113.7')).resolves.toBe(false);
  });

  it('reports an unreachable Cloudflare as a retryable upstream failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );

    await expect(adapter(configuredTurnstile).verify('token', '203.0.113.7')).rejects.toMatchObject({
      details: { isRetryable: true },
    });
  });
});
