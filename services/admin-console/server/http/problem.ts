/** RFC 9457 problem details, the platform's error format, for errors the BFF itself raises. */
import type { FastifyReply } from 'fastify';

export interface Problem {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
}

export function sendProblem(reply: FastifyReply, problem: Problem): FastifyReply {
  return reply
    .code(problem.status)
    .type('application/problem+json')
    .send({ type: 'about:blank', ...problem, requestId: reply.request.id });
}

export const PROBLEMS = {
  notSignedIn: { status: 401, code: 'not_signed_in', title: 'Sign in to continue' },
  invalidCredentials: { status: 401, code: 'invalid_credentials', title: 'Invalid username or password' },
  csrfRejected: {
    status: 403,
    code: 'csrf_rejected',
    title: 'The request did not come from this console',
    detail: 'Reload the page and try again.',
  },
  notFound: { status: 404, code: 'not_found', title: 'No such endpoint' },
  invalidPath: { status: 400, code: 'invalid_path', title: 'The path is not allowed' },
} as const satisfies Record<string, Problem>;

export function tooManyLoginAttempts(retryAfterSeconds: number): Problem {
  return {
    status: 429,
    code: 'too_many_login_attempts',
    title: 'Too many failed sign-in attempts',
    detail: `Wait ${retryAfterSeconds} seconds before trying again.`,
  };
}

export function upstreamUnavailable(serviceName: string, reason: string): Problem {
  return {
    status: 502,
    code: 'upstream_unavailable',
    title: `${serviceName} is not reachable`,
    detail: reason,
  };
}
