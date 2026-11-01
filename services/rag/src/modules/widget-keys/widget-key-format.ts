import { randomBytes } from 'node:crypto';

import type { IncomingHttpHeaders } from 'node:http';

/** Publishable keys are public by design (they sit in page source); the prefix makes that obvious. */
const PUBLISHABLE_KEY_PREFIX = 'pk_';
const PUBLISHABLE_KEY_RANDOM_BYTES = 24;

const WIDGET_KEY_HEADER = 'x-widget-key';

/** `pk_` + 192 random bits, URL-safe Base64: unguessable, so a key cannot be enumerated. */
export function generatePublishableKey(): string {
  return `${PUBLISHABLE_KEY_PREFIX}${randomBytes(PUBLISHABLE_KEY_RANDOM_BYTES).toString('base64url')}`;
}

/**
 * The origin a website's pages run on (`https://www.example.com`, `http://localhost:3000`), or null when the
 * value is not one: another scheme, credentials, a path, query or fragment, or a wildcard.
 */
export function normaliseWebsiteOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const isWebScheme = url.protocol === 'https:' || url.protocol === 'http:';
  const hasOnlyAnOrigin =
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '';
  if (!isWebScheme || !hasOnlyAnOrigin || url.hostname.includes('*')) return null;
  return url.origin;
}

/** The page origin of a browser request: `Origin`, or the origin of `Referer` when a browser omits `Origin`. */
export function requestingOrigin(headers: IncomingHttpHeaders): string | null {
  const origin = headers.origin;
  if (origin !== undefined && origin !== 'null') return normaliseWebsiteOrigin(origin);
  const referer = headers.referer;
  if (referer === undefined) return null;
  try {
    return normaliseWebsiteOrigin(new URL(referer).origin);
  } catch {
    return null;
  }
}

/** The `X-Widget-Key` header, when present. */
export function presentedWidgetKey(headers: IncomingHttpHeaders): string | null {
  const value = headers[WIDGET_KEY_HEADER];
  const key = Array.isArray(value) ? value[0] : value;
  return key === undefined || key.trim() === '' ? null : key.trim();
}
