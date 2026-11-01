/** Composition root: builds the Fastify app from validated configuration. */
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';

import type { ConsoleConfig } from './config.ts';
import { PlatformHealth, type HealthTarget } from './health/platformHealth.ts';
import { PROBLEMS, sendProblem } from './http/problem.ts';
import { registerServiceProxy, type ProxiedService } from './proxy/serviceProxy.ts';
import { registerObservabilityRoutes } from './routes/observabilityRoutes.ts';
import { registerSessionRoutes } from './routes/sessionRoutes.ts';
import { buildAdminGuard } from './security/adminAuthentication.ts';
import { LoginThrottle } from './security/loginThrottle.ts';
import { SessionStore } from './security/sessionStore.ts';

const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
const IMMUTABLE_ASSET_MAX_AGE = 'public, max-age=31536000, immutable';
const READY_PATH = '/health/ready';

const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // Chart libraries position elements with style attributes.
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

function proxiedServices(config: ConsoleConfig): ProxiedService[] {
  const { llmGateway, rag, localLlm } = config.services;
  return [
    {
      mountName: 'llm-gateway',
      displayName: 'LLM gateway',
      baseUrl: llmGateway.baseUrl,
      adminPathPrefix: '/admin/api',
      adminApiKey: llmGateway.adminApiKey,
      blockedFirstSegments: ['session'],
      namesActor: false,
    },
    {
      mountName: 'rag',
      displayName: 'RAG',
      baseUrl: rag.baseUrl,
      adminPathPrefix: '/v1/admin',
      adminApiKey: rag.adminApiKey,
      blockedFirstSegments: ['auth'],
      namesActor: true,
    },
    {
      mountName: 'local-llm',
      displayName: 'Local models',
      baseUrl: localLlm.baseUrl,
      adminPathPrefix: '/admin/v1',
      adminApiKey: localLlm.adminApiKey,
      blockedFirstSegments: [],
      namesActor: false,
    },
  ];
}

function healthTargets(config: ConsoleConfig): HealthTarget[] {
  const { services } = config;
  const ready = (baseUrl: string | undefined) => (baseUrl === undefined ? undefined : `${baseUrl}${READY_PATH}`);
  return [
    {
      id: 'llm-gateway',
      name: 'LLM gateway',
      role: 'Routes every model task',
      url: ready(services.llmGateway.baseUrl),
    },
    { id: 'rag-api', name: 'RAG API', role: 'Chat, retrieval and admin API', url: ready(services.rag.baseUrl) },
    { id: 'rag-worker', name: 'RAG worker', role: 'Ingestion and background jobs', url: ready(services.rag.workerUrl) },
    {
      id: 'document-parser',
      name: 'Document parser',
      role: 'Parses uploaded pages',
      url: ready(services.documentParserUrl),
    },
    { id: 'local-llm', name: 'Local models', role: 'Self-hosted models', url: ready(services.localLlm.baseUrl) },
    {
      id: 'embedding-server',
      name: 'Embedding server',
      role: 'EmbeddingGemma vectors',
      url: ready(services.embeddingServerUrl),
    },
  ];
}

function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof ZodError) {
      return sendProblem(reply, {
        status: 400,
        code: 'invalid_request',
        title: 'The request is not valid',
        detail: error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; '),
      });
    }
    const status = typeof error.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    return sendProblem(reply, {
      status,
      code: status >= 500 ? 'internal_error' : 'bad_request',
      title: status >= 500 ? 'Something went wrong in the console' : error.message,
    });
  });
}

function registerSinglePageApp(app: FastifyInstance, staticDirectory: string): void {
  const root = resolve(staticDirectory);
  const hasBuiltApp = existsSync(resolve(root, 'index.html'));
  if (hasBuiltApp) {
    void app.register(fastifyStatic, {
      root,
      wildcard: false,
      index: false,
      setHeaders: (response, filePath) => {
        response.header('cache-control', filePath.includes('/assets/') ? IMMUTABLE_ASSET_MAX_AGE : 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((request, reply) => {
    const wantsPage = (request.method === 'GET' || request.method === 'HEAD') && !request.url.startsWith('/api/');
    if (wantsPage && hasBuiltApp) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return sendProblem(reply, PROBLEMS.notFound);
  });
}

export function buildApp(config: ConsoleConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.server.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
    },
    trustProxy: config.server.trustProxy,
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });
  app.decorateRequest('adminSession', undefined);

  void app.register(fastifyHelmet, {
    contentSecurityPolicy: { directives: CONTENT_SECURITY_POLICY },
    strictTransportSecurity: config.session.cookieSecure,
  });
  void app.register(fastifyCookie);
  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    if (request.url.startsWith('/api/')) void reply.header('cache-control', 'no-store');
  });
  registerErrorHandling(app);

  app.get('/health/live', () => ({ status: 'alive' }));
  app.get(READY_PATH, () => ({ status: 'ready' }));

  const sessions = new SessionStore({
    ttlSeconds: config.session.ttlSeconds,
    idleTimeoutSeconds: config.session.idleTimeoutSeconds,
  });
  const requireAdmin = buildAdminGuard(sessions, config.session.cookieSecure);
  registerSessionRoutes(app, {
    sessions,
    loginThrottle: new LoginThrottle(config.session.loginMaxFailuresPerMinute),
    admin: config.admin,
    cookie: { secure: config.session.cookieSecure, maxAgeSeconds: config.session.ttlSeconds },
  });
  for (const service of proxiedServices(config)) {
    registerServiceProxy(app, service, requireAdmin, config.timeouts.upstreamMilliseconds);
  }

  registerObservabilityRoutes(app, {
    requireAdmin,
    platformHealth: new PlatformHealth(healthTargets(config), config.timeouts.healthCheckMilliseconds),
  });

  registerSinglePageApp(app, config.staticDirectory);
  return app;
}
