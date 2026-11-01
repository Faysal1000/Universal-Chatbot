/**
 * The one HTTP client of the console. Every call goes to this origin's BFF (`/api/...`), which
 * adds the service credentials; the browser only holds the session cookie and the CSRF token.
 * Errors from every service format (FastAPI `detail`, RFC 9457 problem+json) become `ApiError`.
 */
import { withBasePath } from '@/shared/basePath';

import type { ValidationErrorDetail } from './types';

export const API_BASE_PATHS = {
  console: withBasePath('/api'),
  gateway: withBasePath('/api/llm-gateway'),
  rag: withBasePath('/api/rag'),
  localLlm: withBasePath('/api/local-llm'),
} as const;

const CSRF_HEADER_NAME = 'X-CSRF-Token';
const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type QueryParameterValue = string | number | boolean | null | undefined;

/** A call that did not succeed, with the service's own message and stable code when it sent one. */
export class ApiError extends Error {
  readonly httpStatus: number;
  readonly code: string | undefined;
  readonly validationErrors: ValidationErrorDetail[];
  readonly details: unknown;

  constructor(
    httpStatus: number,
    message: string,
    extra: { code?: string; validationErrors?: ValidationErrorDetail[]; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.code = extra.code;
    this.validationErrors = extra.validationErrors ?? [];
    this.details = extra.details;
  }

  get isUnauthorized(): boolean {
    return this.httpStatus === 401;
  }
}

let csrfToken: string | null = null;
let unauthorizedListener: (() => void) | null = null;

/** Set from the session response; sent on every state-changing request. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Registers the single callback invoked whenever any request returns 401. */
export function setUnauthorizedListener(listener: (() => void) | null): void {
  unauthorizedListener = listener;
}

export interface ApiRequestOptions {
  method?: HttpMethod;
  /** JSON-serialised unless it is FormData. */
  body?: unknown;
  queryParameters?: Record<string, QueryParameterValue>;
  /** When true a 401 is returned to the caller without signing the console out. */
  suppressUnauthorizedRedirect?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, queryParameters?: Record<string, QueryParameterValue>): string {
  const searchParameters = new URLSearchParams();
  for (const [name, value] of Object.entries(queryParameters ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    searchParameters.set(name, String(value));
  }
  const queryString = searchParameters.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function isValidationErrorList(detail: unknown): detail is ValidationErrorDetail[] {
  return (
    Array.isArray(detail) &&
    detail.every((entry: unknown) => typeof entry === 'object' && entry !== null && 'msg' in entry && 'loc' in entry)
  );
}

function describeValidationErrors(validationErrors: ValidationErrorDetail[]): string {
  return validationErrors
    .map((validationError) => {
      const fieldPath = validationError.loc.filter((part) => part !== 'body').join('.');
      return fieldPath ? `${fieldPath}: ${validationError.msg}` : validationError.msg;
    })
    .join('; ');
}

function fallbackMessage(response: Response): string {
  if (response.status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (response.status === 502) return 'The service behind this page is not reachable.';
  return `Request failed with HTTP ${response.status}.`;
}

/** rag's 422 shape: `errors: [{ field, message }]`, mapped onto the FastAPI-style list. */
function readFieldErrors(errors: unknown): ValidationErrorDetail[] {
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { field, message } = entry as Record<string, unknown>;
    return typeof field === 'string' && typeof message === 'string'
      ? [{ loc: ['body', ...field.split('.')], msg: message }]
      : [];
  });
}

/**
 * Turns any service's error body into an ApiError with the most specific message available.
 * `details` is the problem's own `details` object, else the whole body, so fields a service puts
 * at the top level (e.g. rag's `existingDocumentId`) stay reachable.
 */
export function toApiError(response: Response, body: unknown): ApiError {
  if (typeof body !== 'object' || body === null) return new ApiError(response.status, fallbackMessage(response));
  const { detail, title, code, details, errors } = body as Record<string, unknown>;
  const extra = { code: typeof code === 'string' ? code : undefined, details: details ?? body };
  if (isValidationErrorList(detail)) {
    return new ApiError(response.status, describeValidationErrors(detail), { ...extra, validationErrors: detail });
  }
  const fieldErrors = readFieldErrors(errors);
  if (typeof detail === 'string' && typeof title !== 'string') {
    return new ApiError(response.status, detail, { ...extra, validationErrors: fieldErrors });
  }
  const message = [title, detail].filter((part): part is string => typeof part === 'string' && part !== '').join(': ');
  return new ApiError(response.status, message || fallbackMessage(response), {
    ...extra,
    validationErrors: fieldErrors,
  });
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) return (await response.json()) as unknown;
  const text = await response.text();
  return text.length > 0 ? text : undefined;
}

function buildHeaders(method: HttpMethod, body: unknown): Headers {
  const headers = new Headers({ Accept: 'application/json' });
  if (MUTATING_HTTP_METHODS.has(method) && csrfToken !== null) headers.set(CSRF_HEADER_NAME, csrfToken);
  if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  return headers;
}

function serialiseBody(body: unknown): BodyInit | null {
  if (body === undefined) return null;
  return body instanceof FormData ? body : JSON.stringify(body);
}

/** One call to the BFF; `path` is absolute (starts with `/api`). */
async function requestJson<ResponseBody>(path: string, options: ApiRequestOptions = {}): Promise<ResponseBody> {
  const method = options.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.queryParameters), {
      method,
      headers: buildHeaders(method, options.body),
      credentials: 'same-origin',
      body: serialiseBody(options.body),
      signal: options.signal ?? null,
    });
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === 'AbortError') throw networkError;
    throw new ApiError(0, 'Cannot reach the admin console server. Check your connection.');
  }
  const body = await parseResponseBody(response);
  if (!response.ok) {
    if (response.status === 401 && !options.suppressUnauthorizedRedirect) unauthorizedListener?.();
    throw toApiError(response, body);
  }
  return body as ResponseBody;
}

export function requestConsoleApi<ResponseBody>(path: string, options?: ApiRequestOptions): Promise<ResponseBody> {
  return requestJson<ResponseBody>(`${API_BASE_PATHS.console}${path}`, options);
}

export function requestGatewayApi<ResponseBody>(path: string, options?: ApiRequestOptions): Promise<ResponseBody> {
  return requestJson<ResponseBody>(`${API_BASE_PATHS.gateway}${path}`, options);
}

export function requestRagApi<ResponseBody>(path: string, options?: ApiRequestOptions): Promise<ResponseBody> {
  return requestJson<ResponseBody>(`${API_BASE_PATHS.rag}${path}`, options);
}

export function requestLocalLlmApi<ResponseBody>(path: string, options?: ApiRequestOptions): Promise<ResponseBody> {
  return requestJson<ResponseBody>(`${API_BASE_PATHS.localLlm}${path}`, options);
}

export interface UploadProgress {
  loadedBytes: number;
  totalBytes: number;
}

/**
 * Multipart upload with byte progress (fetch cannot report upload progress, XMLHttpRequest can).
 */
export function uploadWithProgress<ResponseBody>(
  path: string,
  formData: FormData,
  onProgress: (progress: UploadProgress) => void,
): Promise<ResponseBody> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', path);
    request.setRequestHeader('Accept', 'application/json');
    if (csrfToken !== null) request.setRequestHeader(CSRF_HEADER_NAME, csrfToken);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress({ loadedBytes: event.loaded, totalBytes: event.total });
    });
    request.addEventListener('error', () => {
      reject(new ApiError(0, 'The upload was interrupted. Check your connection and try again.'));
    });
    request.addEventListener('load', () => {
      const response = new Response(request.status === 204 ? null : request.responseText, {
        status: request.status,
        headers: { 'content-type': request.getResponseHeader('content-type') ?? '' },
      });
      void parseResponseBody(response).then((body) => {
        if (response.ok) {
          resolve(body as ResponseBody);
          return;
        }
        if (response.status === 401) unauthorizedListener?.();
        reject(toApiError(response, body));
      }, reject);
    });
    request.send(formData);
  });
}

/** A human-readable message for any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
