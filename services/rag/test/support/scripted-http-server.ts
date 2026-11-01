import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly bodyText: string;
}

export type ScriptedResponder = (request: RecordedRequest, response: ServerResponse) => void | Promise<void>;

/**
 * A real HTTP server on a random local port that answers with scripted responders, one
 * per incoming request in order, so adapter tests exercise real sockets and streaming.
 */
export class ScriptedHttpServer {
  readonly recordedRequests: RecordedRequest[] = [];
  private readonly responders: ScriptedResponder[] = [];
  private server: Server | undefined;

  static async start(): Promise<ScriptedHttpServer> {
    const scriptedServer = new ScriptedHttpServer();
    await scriptedServer.listen();
    return scriptedServer;
  }

  get baseUrl(): string {
    const address = this.server?.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  respondWith(...responders: ScriptedResponder[]): void {
    this.responders.push(...responders);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.closeAllConnections();
      this.server?.close(() => {
        resolve();
      });
    });
  }

  private async listen(): Promise<void> {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve) => {
      this.server?.listen(0, '127.0.0.1', resolve);
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const bodyChunks: Buffer[] = [];
    for await (const chunk of request) bodyChunks.push(chunk as Buffer);
    const recordedRequest = {
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      headers: request.headers,
      bodyText: Buffer.concat(bodyChunks).toString('utf8'),
    };
    this.recordedRequests.push(recordedRequest);
    const responder = this.responders.shift();
    if (responder === undefined) {
      response.writeHead(599).end('no scripted response left');
      return;
    }
    await responder(recordedRequest, response);
  }
}

export function jsonResponder(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ScriptedResponder {
  return (_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
  };
}

/** Streams `data:` events with a small pause between them, ending with `[DONE]` unless told otherwise. */
export function serverSentEventsResponder(
  dataPayloads: readonly unknown[],
  options: { readonly endWithDone?: boolean; readonly headers?: Record<string, string> } = {},
): ScriptedResponder {
  return async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream', ...options.headers });
    for (const payload of dataPayloads) {
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    if (options.endWithDone ?? true) response.write('data: [DONE]\n\n');
    response.end();
  };
}
