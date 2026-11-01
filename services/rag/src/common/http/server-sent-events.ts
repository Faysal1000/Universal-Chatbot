import type { Response } from 'express';

/** Proxies and load balancers drop idle connections; a comment line keeps them open. */
const KEEP_ALIVE_INTERVAL_MILLISECONDS = 15_000;

/**
 * A `text/event-stream` response. Writes are ignored once the client has gone, so
 * producers can finish their own work without checking the connection each time.
 */
export class ServerSentEventStream {
  private isOpen = true;
  private readonly keepAliveTimer: NodeJS.Timeout;
  private readonly closeListeners: (() => void)[] = [];

  constructor(private readonly response: Response) {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    // Stops nginx-style proxies from buffering the stream.
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    this.keepAliveTimer = setInterval(() => {
      this.writeRaw(': ping\n\n');
    }, KEEP_ALIVE_INTERVAL_MILLISECONDS);
    response.on('close', () => {
      this.markClosed();
    });
  }

  get isClientConnected(): boolean {
    return this.isOpen;
  }

  send(eventName: string, data: unknown, eventId?: string | number): void {
    const idLine = eventId === undefined ? '' : `id: ${String(eventId)}\n`;
    this.writeRaw(`${idLine}event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Registers work to stop when the client disconnects (or the stream ends). */
  onClose(listener: () => void): void {
    if (this.isOpen) this.closeListeners.push(listener);
    else listener();
  }

  end(): void {
    if (!this.isOpen) return;
    this.response.end();
    this.markClosed();
  }

  private writeRaw(text: string): void {
    if (this.isOpen) this.response.write(text);
  }

  private markClosed(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    clearInterval(this.keepAliveTimer);
    for (const listener of this.closeListeners.splice(0)) listener();
  }
}
