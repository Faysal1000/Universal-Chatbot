import {
  createServer,
  request as forward,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

/**
 * Test infrastructure, not a stand-in: a pass-through HTTP proxy between Vite and rag that can cut every open
 * SSE response on demand, the way a flaky network would. Browsers cannot drop an established streaming response
 * themselves (offline emulation only blocks new requests), and the resume logic needs a real mid-stream drop.
 */
export const STREAM_CUTTING_PROXY_PORT = 5291;
const CUT_STREAMS_PATH = '/__e2e/cut-event-streams';

export function startStreamCuttingProxy(targetOrigin: string): Promise<Server> {
  const target = new URL(targetOrigin);
  /** Open answer streams: what Vite receives, and what rag sends. */
  const openEventStreams = new Map<ServerResponse, IncomingMessage>();

  const relay = (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const upstream = forward(
      {
        hostname: target.hostname,
        port: target.port,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: target.host, connection: 'close' },
        agent: false,
      },
      (response) => {
        // One exchange per connection: reusing sockets across cut streams confuses the client's parser.
        outgoing.writeHead(response.statusCode ?? 502, { ...response.headers, connection: 'close' });
        if (response.headers['content-type']?.includes('text/event-stream')) {
          openEventStreams.set(outgoing, response);
          outgoing.on('close', () => openEventStreams.delete(outgoing));
        }
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => outgoing.destroy());
    incoming.pipe(upstream);
  };

  const server = createServer((incoming, outgoing) => {
    if (incoming.method === 'POST' && incoming.url === CUT_STREAMS_PATH) {
      // Ends the client side cleanly but early (a reverse proxy dropping the stream), and hangs up on rag.
      for (const [toClient, fromRag] of openEventStreams) {
        fromRag.unpipe(toClient);
        fromRag.destroy();
        toClient.end();
      }
      openEventStreams.clear();
      outgoing.writeHead(204).end();
      return;
    }
    relay(incoming, outgoing);
  });
  return new Promise((resolve) =>
    server.listen(STREAM_CUTTING_PROXY_PORT, '127.0.0.1', () => resolve(server)),
  );
}

/** Cuts every answer stream currently open through the proxy (called from a test). */
export async function cutOpenEventStreams(): Promise<void> {
  await fetch(`http://127.0.0.1:${STREAM_CUTTING_PROXY_PORT}${CUT_STREAMS_PATH}`, { method: 'POST' });
}
