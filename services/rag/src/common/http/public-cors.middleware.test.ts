import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { createPublicCorsMiddleware, type PublicOriginCheck } from './public-cors.middleware.js';

function fakeExchange(method: string, origin?: string) {
  const headers = new Map<string, string>();
  const response = {
    vary: vi.fn(),
    setHeader: (name: string, value: string) => headers.set(name, value),
    status: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };
  const request = { method, headers: origin === undefined ? {} : { origin } };
  return {
    request: request as unknown as Request,
    response: response as unknown as Response,
    headers,
    raw: response,
  };
}

async function run(isOriginAllowed: PublicOriginCheck, method: string, origin?: string) {
  const exchange = fakeExchange(method, origin);
  const next = vi.fn<() => void>();
  createPublicCorsMiddleware(isOriginAllowed)(exchange.request, exchange.response, next);
  await vi.waitFor(() => {
    expect(next.mock.calls.length + exchange.raw.end.mock.calls.length).toBe(1);
  });
  return { ...exchange, next };
}

describe('createPublicCorsMiddleware', () => {
  it('answers a preflight from an allowed origin, including the widget key header', async () => {
    const { headers, raw, next } = await run(() => Promise.resolve(true), 'OPTIONS', 'https://shop.example');
    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://shop.example');
    expect(headers.get('Access-Control-Allow-Headers')).toContain('X-Widget-Key');
    expect(raw.status).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes a request from another origin on without CORS headers, so the browser blocks it', async () => {
    const { headers, next } = await run(() => Promise.resolve(false), 'GET', 'https://evil.example');
    expect(headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(next).toHaveBeenCalledOnce();
  });

  it('fails closed when the origin check itself fails', async () => {
    const { headers, next } = await run(
      () => Promise.reject(new Error('database down')),
      'GET',
      'https://shop.example',
    );
    expect(headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(next).toHaveBeenCalledOnce();
  });
});
