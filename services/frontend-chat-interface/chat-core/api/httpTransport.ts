import type { z } from 'zod';

import { REQUEST_ID_HEADER } from './chatApiContract';
import { ChatApiError, chatApiErrorFromResponse } from './chatApiError';

export interface HttpTransportOptions {
  baseUrl: string;
  fetchImplementation?: typeof fetch;
  createRequestId?: () => string;
  /** Sent with every request, e.g. the website widget's publishable key (`X-Widget-Key`). */
  defaultHeaders?: Readonly<Record<string, string>>;
}

/**
 * Thin fetch wrapper: resolves paths against the API base URL, tags every request with an `X-Request-ID` to
 * find it in the service logs, and turns network failures and non-2xx responses into `ChatApiError`s.
 */
export class HttpTransport {
  private readonly fetchImplementation: typeof fetch;
  private readonly createRequestId: () => string;

  constructor(private readonly options: HttpTransportOptions) {
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  }

  url(path: string): string {
    return /^(https?:|data:|blob:)/.test(path) ? path : `${this.options.baseUrl}${path}`;
  }

  newRequestId(): string {
    return this.createRequestId();
  }

  get defaultHeaders(): Readonly<Record<string, string>> {
    return this.options.defaultHeaders ?? {};
  }

  async send(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(this.defaultHeaders)) {
      if (!headers.has(name)) headers.set(name, value);
    }
    if (!headers.has(REQUEST_ID_HEADER)) headers.set(REQUEST_ID_HEADER, this.createRequestId());
    let response: Response;
    try {
      response = await this.fetchImplementation(this.url(path), { ...init, headers });
    } catch (cause) {
      if (init.signal?.aborted) throw cause;
      throw new ChatApiError('network', 'Could not reach the chat service.', { cause });
    }
    if (!response.ok) throw await chatApiErrorFromResponse(response);
    return response;
  }
}

/** Validates a JSON body against the contract; a mismatch is a server error, never silently accepted. */
export async function parseJsonResponse<Schema extends z.ZodType>(
  response: Response,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ChatApiError('server', 'The chat service returned an unexpected response.', {
      cause: parsed.error,
      retryable: false,
    });
  }
  return parsed.data;
}
