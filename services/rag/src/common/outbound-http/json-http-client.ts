import {
  isRetryableHttpStatus,
  parseRetryAfterSeconds,
  UpstreamServiceError,
} from './upstream-service-error.js';

export interface JsonRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
  readonly timeoutMilliseconds: number;
  readonly abortSignal?: AbortSignal;
}

/**
 * Sends one JSON request and returns the parsed response body. Every failure becomes an
 * {@link UpstreamServiceError} tagged retryable or permanent, so callers never handle raw
 * fetch errors. Error bodies are summarised by `describeErrorBody`, which each adapter
 * supplies for its service's error format.
 */
export async function sendJsonRequest(
  serviceName: string,
  operation: string,
  request: JsonRequest,
  describeErrorBody: (errorBody: unknown) => { message: string; code?: string } = describeGenericErrorBody,
): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(request.timeoutMilliseconds);
  const response = await issueRequest(serviceName, operation, request, timeoutSignal);
  const responseBody = await readJsonBody(response);
  if (!response.ok) {
    throw toUpstreamServiceError(serviceName, operation, response, describeErrorBody(responseBody));
  }
  return responseBody;
}

/** Reads a failed response's body and turns it into an {@link UpstreamServiceError}. */
export async function upstreamErrorFromResponse(
  serviceName: string,
  operation: string,
  response: Response,
  describeErrorBody: (errorBody: unknown) => { message: string; code?: string },
): Promise<UpstreamServiceError> {
  const responseBody = await readJsonBody(response);
  return toUpstreamServiceError(serviceName, operation, response, describeErrorBody(responseBody));
}

function toUpstreamServiceError(
  serviceName: string,
  operation: string,
  response: Response,
  { message, code }: { message: string; code?: string },
): UpstreamServiceError {
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
  return new UpstreamServiceError(serviceName, operation, `HTTP ${response.status}: ${message}`, {
    httpStatus: response.status,
    isRetryable: isRetryableHttpStatus(response.status),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    ...(code === undefined ? {} : { upstreamCode: code }),
  });
}

/**
 * Issues the request with a timeout that covers connecting and receiving the headers; the
 * caller owns the response body and its own timeout while reading it.
 */
export async function fetchWithTimeout(
  serviceName: string,
  operation: string,
  request: JsonRequest,
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(() => {
    timeoutController.abort();
  }, request.timeoutMilliseconds);
  try {
    return await issueRequest(serviceName, operation, request, timeoutController.signal);
  } finally {
    clearTimeout(timeoutTimer);
  }
}

async function issueRequest(
  serviceName: string,
  operation: string,
  request: JsonRequest,
  timeoutSignal: AbortSignal,
): Promise<Response> {
  const combinedSignal =
    request.abortSignal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, request.abortSignal]);
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: { accept: 'application/json', ...request.headers, ...jsonContentTypeHeader(request) },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: combinedSignal,
    });
  } catch (error: unknown) {
    if (request.abortSignal?.aborted === true) throw error;
    const isTimeout = timeoutSignal.aborted;
    throw new UpstreamServiceError(
      serviceName,
      operation,
      isTimeout ? `timed out after ${request.timeoutMilliseconds} ms` : describeNetworkError(error),
      { isRetryable: true },
    );
  }
}

function jsonContentTypeHeader(request: JsonRequest): Record<string, string> {
  return request.body === undefined ? {} : { 'content-type': 'application/json' };
}

async function readJsonBody(response: Response): Promise<unknown> {
  const bodyText = await response.text();
  if (bodyText === '') return undefined;
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return bodyText.slice(0, 500);
  }
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return 'network error';
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}

function describeGenericErrorBody(errorBody: unknown): { message: string; code?: string } {
  if (typeof errorBody === 'string') return { message: errorBody };
  if (typeof errorBody === 'object' && errorBody !== null) {
    const record = errorBody as Record<string, unknown>;
    const detail = record.detail ?? record.message;
    if (typeof detail === 'string') {
      return { message: detail, ...(typeof record.code === 'string' ? { code: record.code } : {}) };
    }
  }
  return { message: 'no error details' };
}
