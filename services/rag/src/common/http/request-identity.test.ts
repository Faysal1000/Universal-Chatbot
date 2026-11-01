import type { IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { resolveRequestId } from './request-identity.js';

const requestWithHeaders = (headers: IncomingMessage['headers']): IncomingMessage =>
  ({ headers }) as IncomingMessage;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a safe caller-supplied request ID', () => {
    expect(resolveRequestId(requestWithHeaders({ 'x-request-id': 'chat-widget:7f3a.01' }))).toBe(
      'chat-widget:7f3a.01',
    );
  });

  it.each([
    ['contains spaces', 'abc def'],
    ['contains a newline (log injection)', 'abc\ninjected'],
    ['is too long', 'a'.repeat(129)],
    ['is empty', ''],
  ])('replaces an ID that %s with a UUID', (_reason, unsafeRequestId) => {
    expect(resolveRequestId(requestWithHeaders({ 'x-request-id': unsafeRequestId }))).toMatch(UUID_PATTERN);
  });

  it('generates a UUID when the header is absent', () => {
    expect(resolveRequestId(requestWithHeaders({}))).toMatch(UUID_PATTERN);
  });
});
