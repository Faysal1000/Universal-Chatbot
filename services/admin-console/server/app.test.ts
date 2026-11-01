import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { buildApp } from './app.ts';
import {
  buildTestConfig,
  GATEWAY_KEY,
  LOCAL_LLM_KEY,
  RAG_KEY,
  sendJson,
  startStubUpstream,
  type StubUpstream,
  TEST_PASSWORD,
  TEST_USERNAME,
} from './testSupport/testServers.ts';

const COOKIE_NAME = 'admin_console_session';

let upstream: StubUpstream;
let app: FastifyInstance;

beforeEach(async () => {
  upstream = await startStubUpstream((request, response) => {
    if (request.url.startsWith('/health/ready') || request.url.startsWith('/-/ready')) {
      sendJson(response, 200, { status: 'ready' });
      return;
    }
    sendJson(response, 200, { echoed: request.url }, { 'set-cookie': 'upstream=1', 'x-internal': 'secret' });
  });
  app = buildApp(await buildTestConfig(upstream.url));
});

afterEach(async () => {
  await app.close();
  await upstream.close();
});

function sessionCookieFrom(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((candidate) => candidate.name === COOKIE_NAME);
  if (!cookie) throw new Error('no session cookie');
  return cookie.value;
}

function withoutRequestId(response: LightMyRequestResponse): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(response.json<Record<string, unknown>>()).filter(([key]) => key !== 'requestId'),
  );
}

async function signIn(): Promise<{ cookie: string; csrfToken: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  return { cookie: sessionCookieFrom(response), csrfToken: response.json<{ csrfToken: string }>().csrfToken };
}

describe('sign-in', () => {
  it('sets an HttpOnly, SameSite=Strict session cookie and returns the CSRF token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });

    const cookie = response.cookies.find((candidate) => candidate.name === COOKIE_NAME);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    const body = response.json<{ username: string; csrfToken: unknown }>();
    expect(body.username).toBe(TEST_USERNAME);
    expect(typeof body.csrfToken).toBe('string');
  });

  it('rejects wrong credentials with the same answer for user and password', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: TEST_USERNAME, password: 'nope' },
    });
    const wrongUser = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: 'someone', password: TEST_PASSWORD },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(withoutRequestId(wrongUser)).toEqual(withoutRequestId(wrongPassword));
    expect(wrongPassword.cookies).toHaveLength(0);
  });

  it('throttles after five failures a minute, even for the right password', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await app.inject({ method: 'POST', url: '/api/session', payload: { username: TEST_USERNAME, password: 'x' } });
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('refuses a sign-in posted from another site', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('session lifecycle', () => {
  it('returns the session, then signs out with the CSRF token and invalidates the cookie', async () => {
    const { cookie, csrfToken } = await signIn();
    const cookies = { [COOKIE_NAME]: cookie };

    expect((await app.inject({ method: 'GET', url: '/api/session', cookies })).statusCode).toBe(200);
    const withoutToken = await app.inject({ method: 'DELETE', url: '/api/session', cookies });
    expect(withoutToken.statusCode).toBe(403);
    const signOut = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      cookies,
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(signOut.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/session', cookies })).statusCode).toBe(401);
  });

  it('answers 401 problem+json without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/llm-gateway/providers' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'not_signed_in' });
  });
});

describe('service proxy', () => {
  it.each([
    ['llm-gateway', '/admin/api/providers', GATEWAY_KEY],
    ['rag', '/v1/admin/providers', RAG_KEY],
    ['local-llm', '/admin/v1/providers', LOCAL_LLM_KEY],
  ])('forwards /api/%s with that service key and no browser cookie', async (mount, upstreamPath, key) => {
    const { cookie } = await signIn();

    const response = await app.inject({
      method: 'GET',
      url: `/api/${mount}/providers?limit=5`,
      cookies: { [COOKIE_NAME]: cookie },
      headers: { authorization: 'Bearer from-the-browser' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ echoed: `${upstreamPath}?limit=5` });
    const forwarded = upstream.requests.at(-1);
    expect(forwarded?.headers.authorization).toBe(`Bearer ${key}`);
    expect(forwarded?.headers.cookie).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['x-internal']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('names the signed-in admin to rag only, ignoring a value the browser sends', async () => {
    const { cookie } = await signIn();
    const forgedActor = { 'x-admin-actor': 'someone-else' };

    await app.inject({
      method: 'GET',
      url: '/api/rag/audit-events',
      cookies: { [COOKIE_NAME]: cookie },
      headers: forgedActor,
    });
    const forwardedToRag = upstream.requests.at(-1);
    await app.inject({
      method: 'GET',
      url: '/api/llm-gateway/routes',
      cookies: { [COOKIE_NAME]: cookie },
      headers: forgedActor,
    });
    const forwardedToGateway = upstream.requests.at(-1);

    expect(forwardedToRag?.headers['x-admin-actor']).toBe(TEST_USERNAME);
    expect(forwardedToGateway?.headers['x-admin-actor']).toBeUndefined();
  });

  it('requires the CSRF token for writes and passes the raw body through', async () => {
    const { cookie, csrfToken } = await signIn();
    const cookies = { [COOKIE_NAME]: cookie };

    const refused = await app.inject({
      method: 'PUT',
      url: '/api/llm-gateway/routes/answer/chain',
      cookies,
      payload: {},
    });
    const accepted = await app.inject({
      method: 'PUT',
      url: '/api/llm-gateway/routes/answer/chain',
      cookies,
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: '{"steps":[{"model_pk":1}]}',
    });

    expect(refused.statusCode).toBe(403);
    expect(accepted.statusCode).toBe(200);
    expect(upstream.requests.at(-1)).toMatchObject({ method: 'PUT', body: '{"steps":[{"model_pk":1}]}' });
  });

  it.each(['/api/llm-gateway/session', '/api/rag/auth/login', '/api/rag/documents/../auth/me'])(
    'refuses %s',
    async (url) => {
      const { cookie } = await signIn();
      const requestCountBefore = upstream.requests.length;

      const response = await app.inject({ method: 'GET', url, cookies: { [COOKIE_NAME]: cookie } });

      expect([400, 404]).toContain(response.statusCode);
      expect(upstream.requests.length).toBe(requestCountBefore);
    },
  );

  it('answers 502 problem+json when the service is down', async () => {
    const { cookie } = await signIn();
    await upstream.close();

    const response = await app.inject({
      method: 'GET',
      url: '/api/local-llm/deployments',
      cookies: { [COOKIE_NAME]: cookie },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: 'upstream_unavailable', title: 'Local models is not reachable' });
    upstream = await startStubUpstream(() => undefined);
  });
});

describe('platform health', () => {
  it('probes every configured service and marks unconfigured ones', async () => {
    const { cookie } = await signIn();

    const response = await app.inject({
      method: 'GET',
      url: '/api/platform/health',
      cookies: { [COOKIE_NAME]: cookie },
    });

    const services = response.json<{ services: { id: string; status: string }[] }>().services;
    expect(services.find((service) => service.id === 'rag-api')?.status).toBe('ready');
    expect(services.find((service) => service.id === 'rag-worker')?.status).toBe('not_configured');
  });

  it('serves its own liveness without a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/health/live' })).json()).toEqual({ status: 'alive' });
  });
});
