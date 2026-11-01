import { describe, expect, it } from 'vitest';

import {
  generatePublishableKey,
  normaliseWebsiteOrigin,
  presentedWidgetKey,
  requestingOrigin,
} from './widget-key-format.js';

describe('publishable keys', () => {
  it('generates distinct pk_ keys', () => {
    const first = generatePublishableKey();
    const second = generatePublishableKey();
    expect(first).toMatch(/^pk_[A-Za-z0-9_-]{32}$/);
    expect(first).not.toBe(second);
  });

  it('reads the X-Widget-Key header', () => {
    expect(presentedWidgetKey({ 'x-widget-key': ' pk_abc ' })).toBe('pk_abc');
    expect(presentedWidgetKey({})).toBeNull();
  });
});

describe('normaliseWebsiteOrigin', () => {
  it.each([
    ['https://www.example.com', 'https://www.example.com'],
    ['https://www.example.com/', 'https://www.example.com'],
    ['HTTPS://Example.COM:443', 'https://example.com'],
    ['http://localhost:5391', 'http://localhost:5391'],
  ])('accepts %s as %s', (value, origin) => {
    expect(normaliseWebsiteOrigin(value)).toBe(origin);
  });

  it.each([
    'example.com',
    'ftp://example.com',
    'https://example.com/shop',
    'https://example.com?a=1',
    'https://user:secret@example.com',
    'https://*.example.com',
  ])('rejects %s', (value) => {
    expect(normaliseWebsiteOrigin(value)).toBeNull();
  });
});

describe('requestingOrigin', () => {
  it('prefers the Origin header', () => {
    expect(requestingOrigin({ origin: 'https://shop.example', referer: 'https://other.example/x' })).toBe(
      'https://shop.example',
    );
  });

  it('falls back to the Referer origin', () => {
    expect(requestingOrigin({ referer: 'https://shop.example/products/1?x=2' })).toBe('https://shop.example');
  });

  it('treats an opaque or missing origin as unknown', () => {
    expect(requestingOrigin({ origin: 'null' })).toBeNull();
    expect(requestingOrigin({})).toBeNull();
  });
});
