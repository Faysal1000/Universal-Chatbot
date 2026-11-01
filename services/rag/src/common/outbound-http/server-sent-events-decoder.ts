export interface ServerSentEvent {
  readonly eventName: string;
  readonly data: string;
}

/**
 * Incremental decoder for `text/event-stream` (WHATWG HTML §9.2). Feed it decoded text in
 * arbitrary chunks; it returns every event completed by that chunk. Comments (`:`) and
 * the `id`/`retry` fields are ignored because no consumer here needs them.
 */
export class ServerSentEventsDecoder {
  private pendingText = '';
  private eventName = '';
  private dataLines: string[] = [];

  decode(textChunk: string): ServerSentEvent[] {
    this.pendingText += textChunk;
    const completedEvents: ServerSentEvent[] = [];
    let lineEnd = findLineEnd(this.pendingText);
    while (lineEnd !== undefined) {
      const line = this.pendingText.slice(0, lineEnd.index);
      this.pendingText = this.pendingText.slice(lineEnd.index + lineEnd.length);
      const completedEvent = this.consumeLine(line);
      if (completedEvent !== undefined) completedEvents.push(completedEvent);
      lineEnd = findLineEnd(this.pendingText);
    }
    return completedEvents;
  }

  private consumeLine(line: string): ServerSentEvent | undefined {
    if (line === '') return this.dispatchEvent();
    if (line.startsWith(':')) return undefined;
    const separatorIndex = line.indexOf(':');
    const fieldName = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
    const fieldValue = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (fieldName === 'event') this.eventName = fieldValue;
    if (fieldName === 'data') this.dataLines.push(fieldValue);
    return undefined;
  }

  private dispatchEvent(): ServerSentEvent | undefined {
    const hasData = this.dataLines.length > 0;
    const event = {
      eventName: this.eventName === '' ? 'message' : this.eventName,
      data: this.dataLines.join('\n'),
    };
    this.eventName = '';
    this.dataLines = [];
    return hasData ? event : undefined;
  }
}

/** Finds the first CRLF, LF or CR. A trailing lone CR waits for the next chunk (it may be CRLF). */
function findLineEnd(text: string): { index: number; length: number } | undefined {
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\n') return { index, length: 1 };
    if (character === '\r') {
      if (index + 1 === text.length) return undefined;
      return { index, length: text[index + 1] === '\n' ? 2 : 1 };
    }
  }
  return undefined;
}
