import { describe, expect, it } from 'vitest';

import { SseStreamParser } from './sseStreamParser';
import { decodeTurnStreamEvent } from './turnStreamDecoder';

describe('SseStreamParser', () => {
  it('parses complete events with names, ids and data', () => {
    const parser = new SseStreamParser();
    const events = parser.push('id: 1\nevent: answer.delta\ndata: {"text":"Hi"}\n\n');
    expect(events).toEqual([{ event: 'answer.delta', data: '{"text":"Hi"}', id: '1' }]);
  });

  it('reassembles events split at arbitrary chunk boundaries', () => {
    const wire =
      'id: 7\nevent: answer.delta\ndata: {"text":"Hello"}\n\nid: 8\nevent: answer.delta\ndata: {"text":" world"}\n\n';
    for (let splitSize = 1; splitSize <= 9; splitSize += 1) {
      const parser = new SseStreamParser();
      const events = [];
      for (let i = 0; i < wire.length; i += splitSize)
        events.push(...parser.push(wire.slice(i, i + splitSize)));
      expect(events.map((e) => e.data)).toEqual(['{"text":"Hello"}', '{"text":" world"}']);
      expect(parser.currentEventId).toBe('8');
    }
  });

  it('accepts CRLF and CR line endings, including a CRLF split across chunks', () => {
    const parser = new SseStreamParser();
    const events = [...parser.push('data: a\r'), ...parser.push('\n\r\n'), ...parser.push('data: b\r\r')];
    expect(events.map((e) => e.data)).toEqual(['a', 'b']);
  });

  it('joins multi-line data with newlines and defaults the event name to "message"', () => {
    const parser = new SseStreamParser();
    expect(parser.push('data: line one\ndata: line two\n\n')).toEqual([
      { event: 'message', data: 'line one\nline two', id: null },
    ]);
  });

  it('ignores comments (heartbeats), unknown fields and events without data', () => {
    const parser = new SseStreamParser();
    expect(parser.push(': ping\n\nfoo: bar\n\nevent: noop\n\n')).toEqual([]);
  });

  it('keeps the last event id across events and ignores ids containing NUL', () => {
    const parser = new SseStreamParser();
    parser.push('id: 3\ndata: x\n\n');
    const [event] = parser.push('id: bad\u0000id\ndata: y\n\n');
    expect(event?.id).toBe('3');
  });

  it('records the server retry hint', () => {
    const parser = new SseStreamParser();
    parser.push('retry: 2500\n\n');
    expect(parser.retryDelayMs).toBe(2500);
  });

  it('discards an unterminated trailing event at end of stream', () => {
    const parser = new SseStreamParser();
    expect(parser.push('data: partial')).toEqual([]);
    expect(parser.end()).toEqual([]);
  });

  it('strips only a single leading space from values', () => {
    const parser = new SseStreamParser();
    expect(parser.push('data:  two spaces\n\n')[0]?.data).toBe(' two spaces');
  });
});

describe('decodeTurnStreamEvent', () => {
  it('validates known events against the contract', () => {
    const result = decodeTurnStreamEvent({ event: 'answer.delta', data: '{"text":"ok"}', id: '1' });
    expect(result).toEqual({
      kind: 'event',
      event: { type: 'answer.delta', eventId: '1', data: { text: 'ok' } },
    });
  });

  it('ignores unknown events for forward compatibility', () => {
    expect(decodeTurnStreamEvent({ event: 'future.event', data: '{}', id: null })).toEqual({
      kind: 'ignored',
      reason: 'unknown_event',
    });
  });

  it('reports malformed payloads of known events', () => {
    expect(decodeTurnStreamEvent({ event: 'answer.delta', data: 'not json', id: null }).kind).toBe('invalid');
    expect(decodeTurnStreamEvent({ event: 'answer.delta', data: '{"text":42}', id: null }).kind).toBe(
      'invalid',
    );
  });
});
