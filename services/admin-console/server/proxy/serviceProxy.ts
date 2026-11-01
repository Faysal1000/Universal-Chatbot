/**
 * Streams `/api/<service>/<path>` to the service's admin API, adding the service's admin key.
 * Only the admin prefix is reachable, only allow-listed headers cross in either direction, and
 * no service credential or cookie ever reaches the browser. Bodies stream both ways, so uploads
 * and server-sent events pass through without buffering.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';

import { PROBLEMS, sendProblem, upstreamUnavailable } from '../http/problem.ts';
import type { buildAdminGuard } from '../security/adminAuthentication.ts';

export interface ProxiedService {
  /** Path segment after `/api/`, e.g. `llm-gateway`. */
  readonly mountName: string;
  readonly displayName: string;
  readonly baseUrl: string;
  /** The service's admin API prefix, e.g. `/admin/api`. */
  readonly adminPathPrefix: string;
  readonly adminApiKey: string;
  /** First path segments the console must not use (e.g. the service's own login). */
  readonly blockedFirstSegments: readonly string[];
  /** Whether to name the signed-in admin in `X-Admin-Actor` (rag records it in its audit log). */
  readonly namesActor: boolean;
}

/** Set only by the console from its session; a browser's own value is never forwarded. */
const ADMIN_ACTOR_HEADER = 'x-admin-actor';

const FORWARDED_REQUEST_HEADERS = ['accept', 'content-type', 'content-length', 'last-event-id', 'if-none-match'];
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'cache-control',
  'etag',
  'last-modified',
  'retry-after',
  'x-request-id',
  'x-trace-id',
];
const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~:@-]+$/;

type AdminGuard = ReturnType<typeof buildAdminGuard>;

/** Accepts only plain path segments: no `..`, no empty or encoded separators. */
function isAllowedSubpath(subpath: string, blockedFirstSegments: readonly string[]): boolean {
  if (subpath === '') return false;
  const segments = subpath.split('/');
  const [firstSegment = ''] = segments;
  if (blockedFirstSegments.includes(firstSegment)) return false;
  return segments.every((segment) => segment !== '.' && segment !== '..' && PATH_SEGMENT_PATTERN.test(segment));
}

function buildUpstreamUrl(service: ProxiedService, subpath: string, rawUrl: string): string {
  const queryStart = rawUrl.indexOf('?');
  const query = queryStart === -1 ? '' : rawUrl.slice(queryStart);
  return `${service.baseUrl}${service.adminPathPrefix}/${subpath}${query}`;
}

function pickRequestHeaders(request: FastifyRequest, service: ProxiedService): Headers {
  const headers = new Headers({ authorization: `Bearer ${service.adminApiKey}`, 'x-request-id': request.id });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  if (service.namesActor && request.adminSession) headers.set(ADMIN_ACTOR_HEADER, request.adminSession.username);
  return headers;
}

function pickResponseHeaders(upstreamHeaders: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstreamHeaders.get(name);
    if (value !== null) headers[name] = value;
  }
  return headers;
}

/** Aborts when the client goes away, or when the upstream sends no headers within the timeout. */
function createUpstreamAbort(reply: FastifyReply, headerTimeoutMilliseconds: number) {
  const controller = new AbortController();
  const headerTimer = setTimeout(() => {
    controller.abort(new Error(`no response within ${headerTimeoutMilliseconds / 1000} s`));
  }, headerTimeoutMilliseconds);
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished) controller.abort(new Error('client closed'));
  });
  return { signal: controller.signal, headersReceived: () => clearTimeout(headerTimer) };
}

async function forward(
  request: FastifyRequest<{ Params: { '*': string } }>,
  reply: FastifyReply,
  service: ProxiedService,
  headerTimeoutMilliseconds: number,
): Promise<FastifyReply> {
  const subpath = request.params['*'];
  if (!isAllowedSubpath(subpath, service.blockedFirstSegments)) return sendProblem(reply, PROBLEMS.invalidPath);

  const hasBody = METHODS_WITH_BODY.has(request.method) && request.body !== undefined;
  const upstreamAbort = createUpstreamAbort(reply, headerTimeoutMilliseconds);
  let upstream: Response;
  try {
    upstream = await fetch(buildUpstreamUrl(service, subpath, request.url), {
      method: request.method,
      headers: pickRequestHeaders(request, service),
      body: hasBody ? request.body : undefined,
      duplex: 'half',
      redirect: 'manual',
      signal: upstreamAbort.signal,
    } as RequestInit);
  } catch (error) {
    const reason = upstreamAbort.signal.aborted ? String(upstreamAbort.signal.reason) : (error as Error).message;
    request.log.warn({ service: service.mountName, reason }, 'upstream request failed');
    upstreamAbort.headersReceived();
    return sendProblem(reply, upstreamUnavailable(service.displayName, reason));
  }
  upstreamAbort.headersReceived();

  void reply.code(upstream.status).headers(pickResponseHeaders(upstream.headers));
  if (upstream.body === null) return reply.send();
  return reply.send(Readable.fromWeb(upstream.body));
}

/** Registers `ALL /api/<mountName>/*` in its own scope, where bodies stay raw streams. */
export function registerServiceProxy(
  app: FastifyInstance,
  service: ProxiedService,
  requireAdmin: AdminGuard,
  headerTimeoutMilliseconds: number,
): void {
  void app.register((scope, _options, done) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, payload, parsed) => {
      parsed(null, payload);
    });
    scope.all<{ Params: { '*': string } }>(
      `/api/${service.mountName}/*`,
      { onRequest: requireAdmin },
      (request, reply) => forward(request, reply, service, headerTimeoutMilliseconds),
    );
    done();
  });
}
