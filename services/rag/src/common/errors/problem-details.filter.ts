import { STATUS_CODES } from 'node:http';

import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { requestIdOf } from '../http/request-identity.js';
import { UpstreamServiceError } from '../outbound-http/upstream-service-error.js';
import { StoredObjectNotFoundError } from '../../ports/object-storage.port.js';
import { ApplicationError } from './application-error.js';
import {
  PROBLEM_JSON_CONTENT_TYPE,
  type ProblemDetails,
  type ProblemDetailsMembers,
  type ProblemFieldError,
} from './problem-details.js';

const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred. Quote the requestId when contacting support.';

interface ClassifiedError {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly fieldErrors?: readonly ProblemFieldError[];
  readonly retryAfterSeconds?: number;
  readonly details?: ProblemDetailsMembers;
  readonly isUnexpected: boolean;
}

/** Errors from Express middleware (e.g. body-parser) carry `status`, `type` and `expose`. */
interface HttpErrorLike {
  readonly status: number;
  readonly type?: string;
  readonly expose?: boolean;
  readonly message: string;
}

function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as Partial<HttpErrorLike>;
  return (
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 500 &&
    candidate.expose === true
  );
}

function toErrorCode(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function describeHttpException(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.filter((part): part is string => typeof part === 'string').join('; ');
  }
  return exception.message;
}

export function classifyError(exception: unknown): ClassifiedError {
  if (exception instanceof UpstreamServiceError) {
    return {
      status: exception.details.isRetryable ? 503 : 502,
      code: 'upstream_failed',
      detail: `A dependency (${exception.serviceName}) is unavailable. Try again shortly.`,
      ...(exception.details.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: exception.details.retryAfterSeconds }),
      isUnexpected: false,
    };
  }
  if (exception instanceof StoredObjectNotFoundError) {
    return {
      status: 404,
      code: 'file_not_found',
      detail: 'The stored file no longer exists.',
      isUnexpected: false,
    };
  }
  if (exception instanceof ApplicationError) {
    return {
      status: exception.httpStatus,
      code: exception.code,
      detail: exception.clientMessage,
      ...(exception.fieldErrors === undefined ? {} : { fieldErrors: exception.fieldErrors }),
      ...(exception.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: exception.retryAfterSeconds }),
      ...(exception.details === undefined ? {} : { details: exception.details }),
      isUnexpected: exception.httpStatus >= 500,
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) {
      return { status, code: 'internal_error', detail: INTERNAL_ERROR_MESSAGE, isUnexpected: true };
    }
    return {
      status,
      code: status === 404 ? 'route_not_found' : toErrorCode(STATUS_CODES[status] ?? 'client_error'),
      detail: describeHttpException(exception),
      isUnexpected: false,
    };
  }
  if (isHttpErrorLike(exception)) {
    return {
      status: exception.status,
      code: exception.type !== undefined ? toErrorCode(exception.type) : 'invalid_request',
      detail: exception.message,
      isUnexpected: false,
    };
  }
  return { status: 500, code: 'internal_error', detail: INTERNAL_ERROR_MESSAGE, isUnexpected: true };
}

/**
 * Converts every error into an RFC 9457 `application/problem+json` response. Unexpected
 * errors are logged with their stack; clients only ever see a generic message plus
 * the request ID to find it in the logs.
 */
@Catch()
export class ProblemDetailsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const classifiedError = classifyError(exception);
    const requestId = requestIdOf(request);

    if (classifiedError.isUnexpected) {
      this.logger.error({ err: exception, requestId }, 'Unhandled error while processing request');
    }

    if (response.headersSent) {
      // A streaming response already started; the only safe action is to end it.
      response.end();
      return;
    }

    const problemDetails: ProblemDetails = {
      type: 'about:blank',
      title: STATUS_CODES[classifiedError.status] ?? 'Error',
      status: classifiedError.status,
      detail: classifiedError.detail,
      instance: request.originalUrl.split('?')[0] ?? '/',
      code: classifiedError.code,
      ...(requestId === undefined ? {} : { requestId }),
      ...(classifiedError.fieldErrors === undefined ? {} : { errors: classifiedError.fieldErrors }),
      ...(classifiedError.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: classifiedError.retryAfterSeconds }),
      ...(classifiedError.details === undefined ? {} : { details: classifiedError.details }),
    };
    if (classifiedError.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(classifiedError.retryAfterSeconds));
    }
    response
      .status(classifiedError.status)
      .type(PROBLEM_JSON_CONTENT_TYPE)
      .send(JSON.stringify(problemDetails));
  }
}
