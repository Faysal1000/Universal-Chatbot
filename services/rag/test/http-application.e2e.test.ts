import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ApiModule } from '../src/app/api.module.js';
import { WorkerModule } from '../src/app/worker.module.js';
import { createTestApplication, type TestApplication } from './support/test-application.js';

const PROBLEM_JSON = /^application\/problem\+json/;

describe('API process over HTTP', () => {
  let testApplication: TestApplication;
  const httpServer = () => testApplication.application.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    testApplication = await createTestApplication(
      'api',
      (configuration) => ApiModule.register(configuration),
      {
        RAG_JSON_BODY_LIMIT_BYTES: '2048',
      },
    );
  });
  afterAll(async () => {
    await testApplication.application.close();
  });
  beforeEach(() => {
    for (const healthCheck of testApplication.healthChecks) healthCheck.isHealthy = true;
  });

  describe('health', () => {
    it('GET /health/live reports alive and assigns a request ID', async () => {
      const response = await request(httpServer()).get('/health/live').expect(200);

      expect(response.body).toEqual({ status: 'alive' });
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('GET /health/ready is 200 when every dependency is up', async () => {
      const response = await request(httpServer()).get('/health/ready').expect(200);

      expect(response.body).toEqual({
        status: 'ready',
        checks: { postgres: 'up', redis: 'up', object_storage: 'up' },
      });
    });

    it('GET /health/ready is 503 and names the dependency that is down', async () => {
      testApplication.healthChecks[2]!.isHealthy = false;

      const response = await request(httpServer()).get('/health/ready').expect(503);

      expect(response.body).toMatchObject({
        status: 'not_ready',
        checks: { object_storage: 'down', postgres: 'up' },
      });
    });
  });

  describe('errors as RFC 9457 problem details', () => {
    it('returns problem+json for an unknown route, echoing a safe caller request ID', async () => {
      const response = await request(httpServer())
        .get('/v1/does-not-exist?token=secret')
        .set('X-Request-ID', 'postman-run-42')
        .expect(404);

      expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
      expect(response.headers['x-request-id']).toBe('postman-run-42');
      expect(JSON.parse(response.text)).toEqual({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Cannot GET /v1/does-not-exist?token=secret',
        instance: '/v1/does-not-exist',
        code: 'route_not_found',
        requestId: 'postman-run-42',
      });
    });

    it('rejects malformed JSON with a 400 problem', async () => {
      const response = await request(httpServer())
        .post('/v1/anything')
        .set('Content-Type', 'application/json')
        .send('{"broken": ')
        .expect(400);

      expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
      expect(JSON.parse(response.text)).toMatchObject({ status: 400, code: 'invalid_json' });
    });

    it('rejects a JSON body above the configured limit with a 413 problem', async () => {
      const response = await request(httpServer())
        .post('/v1/anything')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ text: 'x'.repeat(4096) }))
        .expect(413);

      expect(JSON.parse(response.text)).toMatchObject({ status: 413, code: 'payload_too_large' });
    });
  });

  describe('hardening', () => {
    it('sets security headers and hides the framework', async () => {
      const response = await request(httpServer()).get('/health/live');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['content-security-policy']).toBeDefined();
    });

    it('does not serve API docs unless enabled', async () => {
      await request(httpServer()).get('/openapi.json').expect(404);
    });
  });
});

describe('API docs when enabled', () => {
  it('serves the OpenAPI document including the health endpoints', async () => {
    const { application } = await createTestApplication(
      'api',
      (configuration) => ApiModule.register(configuration),
      {
        RAG_ENABLE_API_DOCS: 'true',
      },
    );
    try {
      const response = await request(application.getHttpServer() as Parameters<typeof request>[0])
        .get('/openapi.json')
        .expect(200);
      const openApiDocument = response.body as { info: { title: string }; paths: Record<string, unknown> };

      expect(openApiDocument.info.title).toBe('RAG API');
      expect(Object.keys(openApiDocument.paths)).toEqual(
        expect.arrayContaining(['/health/live', '/health/ready']),
      );
    } finally {
      await application.close();
    }
  });
});

describe('worker process over HTTP', () => {
  it('serves health', async () => {
    const { application } = await createTestApplication('worker', (configuration) =>
      WorkerModule.register(configuration),
    );
    try {
      const httpServer = application.getHttpServer() as Parameters<typeof request>[0];
      await request(httpServer).get('/health/ready').expect(200);
    } finally {
      await application.close();
    }
  });
});
