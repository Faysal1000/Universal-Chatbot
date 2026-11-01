/**
 * Incremental parser for the `text/event-stream` wire format (WHATWG HTML §9.2).
 *
 * `EventSource` cannot POST or send headers, so turns are streamed with `fetch` and decoded here. The parser is
 * transport-agnostic: feed it decoded text chunks in any split (mid-line, mid-CRLF, mid-event) and it emits
 * complete events. Comment lines (`: ping`) are ignored, `id` is tracked for `Last-Event-ID` resume.
 */
export interface ServerSentEvent {
  /** Event name; defaults to `message` per the spec. */
  event: string;
  data: string;
  /** Last event id seen on the stream so far (persists across events, as in the spec). */
  id: string | null;
}

export class SseStreamParser {
  private buffer = '';
  private eventName = '';
  private dataLines: string[] = [];
  private lastEventId: string | null = null;
  private pendingCarriageReturn = false;
  private reconnectionDelayMs: number | null = null;

  /** Feed a chunk of decoded text; returns the events completed by this chunk. */
  push(chunk: string): ServerSentEvent[] {
    let text = chunk;
    // A CRLF split across chunks: the previous chunk ended in CR and was already treated as a line end.
    if (this.pendingCarriageReturn && text.startsWith('\n')) text = text.slice(1);
    this.pendingCarriageReturn = text.endsWith('\r');
    this.buffer += text;

    const events: ServerSentEvent[] = [];
    const lineBreak = /\r\n|\r|\n/g;
    let consumedUpTo = 0;
    let match: RegExpExecArray | null;
    while ((match = lineBreak.exec(this.buffer)) !== null) {
      const line = this.buffer.slice(consumedUpTo, match.index);
      consumedUpTo = match.index + match[0].length;
      const event = this.processLine(line);
      if (event) events.push(event);
    }
    this.buffer = this.buffer.slice(consumedUpTo);
    return events;
  }

  /** Flush at end of stream. Per the spec an unterminated final event is discarded. */
  end(): ServerSentEvent[] {
    this.buffer = '';
    this.eventName = '';
    this.dataLines = [];
    return [];
  }

  get currentEventId(): string | null {
    return this.lastEventId;
  }

  /** Server-requested reconnection delay from a `retry:` field, if any. */
  get retryDelayMs(): number | null {
    return this.reconnectionDelayMs;
  }

  private processLine(line: string): ServerSentEvent | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        this.eventName = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\u0000')) this.lastEventId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.reconnectionDelayMs = Number(value);
        break;
      default:
        break;
    }
    return null;
  }

  private dispatch(): ServerSentEvent | null {
    if (this.dataLines.length === 0) {
      this.eventName = '';
      return null;
    }
    const event: ServerSentEvent = {
      event: this.eventName || 'message',
      data: this.dataLines.join('\n'),
      id: this.lastEventId,
    };
    this.eventName = '';
    this.dataLines = [];
    return event;
  }
}
