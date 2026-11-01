/**
 * Calls the BFF with the signed-in test session, for arranging and cleaning up state. Writes
 * carry the session's CSRF token exactly like the SPA does.
 */
import { expect, type APIRequestContext } from '@playwright/test';

export class ConsoleApi {
  readonly #request: APIRequestContext;
  #csrfToken: string | undefined;

  constructor(request: APIRequestContext) {
    this.#request = request;
  }

  async get<Body>(path: string): Promise<Body> {
    const response = await this.#request.get(`/api${path}`);
    expect(response.ok(), `GET ${path} → ${response.status()}`).toBe(true);
    return (await response.json()) as Body;
  }

  async send<Body>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<Body> {
    const response = await this.#request.fetch(`/api${path}`, {
      method,
      data,
      headers: { 'x-csrf-token': await this.#token() },
    });
    expect(response.ok(), `${method} ${path} → ${response.status()} ${await response.text()}`).toBe(true);
    return (response.status() === 204 ? undefined : await response.json()) as Body;
  }

  async #token(): Promise<string> {
    this.#csrfToken ??= (await this.get<{ csrfToken: string }>('/session')).csrfToken;
    return this.#csrfToken;
  }
}
