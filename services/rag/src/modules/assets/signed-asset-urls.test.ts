import { afterEach, describe, expect, it, vi } from 'vitest';

import { validTestEnvironment } from '../../../test/support/test-environment.js';
import { parseConfiguration } from '../../config/configuration.js';
import { ASSET_ROUTE_PREFIX, SignedAssetUrls } from './signed-asset-urls.js';

function signedAssetUrls(clientHashSecret = 'test-client-hash-secret-with-32-characters'): SignedAssetUrls {
  return new SignedAssetUrls(
    parseConfiguration(validTestEnvironment({ RAG_CLIENT_HASH_SECRET: clientHashSecret })),
  );
}

function tokenOf(url: string): string {
  return url.slice(`${ASSET_ROUTE_PREFIX}/`.length);
}

describe('SignedAssetUrls', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies its own URL and returns the signed claims', () => {
    const urls = signedAssetUrls();

    const { url } = urls.sign('attachments/123', 'image/png', 600);

    expect(urls.verify(tokenOf(url))).toMatchObject({ key: 'attachments/123', contentType: 'image/png' });
  });

  it('rejects a URL whose claims were changed', () => {
    const urls = signedAssetUrls();
    const [, signature] = tokenOf(urls.sign('attachments/123', 'image/png', 600).url).split('.');
    const forgedClaims = Buffer.from(
      JSON.stringify({
        key: 'originals/secret',
        contentType: 'application/pdf',
        expiresAtSeconds: 9_999_999_999,
      }),
    ).toString('base64url');

    expect(() => urls.verify(`${forgedClaims}.${signature ?? ''}`)).toThrow(/invalid or has expired/);
  });

  it('rejects a URL signed with another secret', () => {
    const { url } = signedAssetUrls('another-client-hash-secret-with-32-chars').sign('a', 'image/png', 600);

    expect(() => signedAssetUrls().verify(tokenOf(url))).toThrow(/invalid or has expired/);
  });

  it('rejects an expired URL', () => {
    vi.useFakeTimers({ now: new Date('2026-10-30T12:00:00Z') });
    const urls = signedAssetUrls();
    const { url } = urls.sign('attachments/123', 'image/png', 60);

    vi.setSystemTime(new Date('2026-10-30T12:01:01Z'));

    expect(() => urls.verify(tokenOf(url))).toThrow(/invalid or has expired/);
  });
});
