import { describe, expect, it } from 'vitest';

import { ServerSentEventsDecoder } from './server-sent-events-decoder.js';

describe('ServerSentEventsDecoder', () => {
  it('emits an event only once its terminating blank line arrives', () => {
    const decoder = new ServerSentEventsDecoder();

    expect(decoder.decode('data: {"a":')).toEqual([]);
    expect(decoder.decode('1}\n')).toEqual([]);
    expect(decoder.decode('\n')).toEqual([{ eventName: 'message', data: '{"a":1}' }]);
  });

  it('handles CRLF and lone CR line endings, including a CRLF split across chunks', () => {
    const decoder = new ServerSentEventsDecoder();

    const events = [...decoder.decode('data: one\r'), ...decoder.decode('\n\r\ndata: two\r\r\n')];

    expect(events.map((event) => event.data)).toEqual(['one', 'two']);
  });

  it('joins multi-line data, keeps event names and ignores comments', () => {
    const decoder = new ServerSentEventsDecoder();

    const events = decoder.decode(': ping\n\nevent: status\ndata: first\ndata: second\nid: 7\n\n');

    expect(events).toEqual([{ eventName: 'status', data: 'first\nsecond' }]);
  });
});
