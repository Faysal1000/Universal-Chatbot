/**
 * Test-only helpers: a real HTTP server standing in for an upstream service, and a valid
 * console configuration pointing at it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { loadConfig, type ConsoleConfig } from '../config.ts';
import { hashPassword } from '../security/passwordHash.ts';

export const TEST_USERNAME = 'operator';
export const TEST_PASSWORD = 'correct-horse-battery-staple';
export const GATEWAY_KEY = 'gateway-admin-key-0123456789abcdefghijkl';
export const RAG_KEY = 'rag-admin-key-0123456789abcdefghijklmnopq';
export const LOCAL_LLM_KEY = 'local-llm-admin-key-0123456789abcdefghij';

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface StubUpstream {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

export type StubHandler = (request: RecordedRequest, response: ServerResponse) => void;

export async function startStubUpstream(handler: StubHandler): Promise<StubUpstream> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const recorded = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(recorded);
      handler(recorded, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

let cachedPasswordHash: Promise<string> | undefined;

export async function buildTestConfig(
  upstreamUrl: string,
  overrides: Record<string, string> = {},
): Promise<ConsoleConfig> {
  cachedPasswordHash ??= hashPassword(TEST_PASSWORD);
  return loadConfig({
    ADMIN_CONSOLE_ADMIN_USERNAME: TEST_USERNAME,
    ADMIN_CONSOLE_ADMIN_PASSWORD_HASH: await cachedPasswordHash,
    ADMIN_CONSOLE_COOKIE_SECURE: 'false',
    ADMIN_CONSOLE_LOG_LEVEL: 'fatal',
    ADMIN_CONSOLE_STATIC_DIRECTORY: '/nonexistent',
    ADMIN_CONSOLE_LLM_GATEWAY_URL: upstreamUrl,
    ADMIN_CONSOLE_LLM_GATEWAY_ADMIN_API_KEY: GATEWAY_KEY,
    ADMIN_CONSOLE_RAG_URL: upstreamUrl,
    ADMIN_CONSOLE_RAG_ADMIN_API_KEY: RAG_KEY,
    ADMIN_CONSOLE_LOCAL_LLM_URL: upstreamUrl,
    ADMIN_CONSOLE_LOCAL_LLM_ADMIN_API_KEY: LOCAL_LLM_KEY,
    ADMIN_CONSOLE_EMBEDDING_SERVER_URL: upstreamUrl,
    ...overrides,
  });
}
