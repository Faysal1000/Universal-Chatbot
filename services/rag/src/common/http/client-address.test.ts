import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { resolveClientAddress } from './client-address.js';

const requestFrom = (socketAddress: string, forwardedFor?: string) =>
  ({
    socket: { remoteAddress: socketAddress },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  }) as unknown as Request;

describe('resolveClientAddress', () => {
  it('ignores X-Forwarded-For when no proxy is trusted', () => {
    expect(resolveClientAddress(requestFrom('::ffff:10.0.0.5', '1.2.3.4'), 0)).toBe('10.0.0.5');
  });

  it('takes the entry appended by the trusted proxy, not a client-supplied one', () => {
    const spoofedRequest = requestFrom('10.0.0.1', '6.6.6.6, 203.0.113.7');

    expect(resolveClientAddress(spoofedRequest, 1)).toBe('203.0.113.7');
  });

  it('walks back one entry per trusted proxy', () => {
    expect(resolveClientAddress(requestFrom('10.0.0.1', '203.0.113.7, 10.0.0.9'), 2)).toBe('203.0.113.7');
  });

  it('falls back to the socket address when the header is missing', () => {
    expect(resolveClientAddress(requestFrom('192.0.2.10'), 1)).toBe('192.0.2.10');
  });
});
