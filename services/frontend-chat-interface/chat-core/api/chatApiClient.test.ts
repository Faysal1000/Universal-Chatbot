import { describe, expect, it, vi } from 'vitest';

import { ChatApiClient, reconnectDelayMs, type VisitorSessionStore } from './chatApiClient';
import type { SubmitTurnRequest, TurnStreamEvent, VisitorSession } from './chatApiContract';
import { ChatApiError, parseRetryAfterHeader } from './chatApiError';

const SESSION: VisitorSession = {
  sessionId: 's',
  sessionToken: 'token-1',
  expiresAt: '2999-01-01T00:00:00Z',
};

function memorySessionStore(
  initial: VisitorSession | null = SESSION,
): VisitorSessionStore & { current: VisitorSession | null } {
  return {
    current: initial,
    load() {
      return this.current;
    },
    save(session) {
      this.current = session;
    },
    clear() {
      this.current = null;
    },
  };
}

/** A streaming Response whose body yields the given chunks, then either ends or errors (simulated drop). */
function sseResponse(chunks: string[], options: { dropAtEnd?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  const queue = [...chunks];
  // Pull-based so every chunk is read before the simulated drop (erroring discards queued chunks).
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next !== undefined) controller.enqueue(encoder.encode(next));
      else if (options.dropAtEnd) controller.error(new TypeError('network error'));
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function sse(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function problem(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ status, code, detail: `${code} detail` }), {
    status,
    headers: { 'Content-Type': 'application/problem+json', ...headers },
  });
}

const request: SubmitTurnRequest = {
  turnId: 'turn-1',
  replacesTurnId: null,
  messages: [
    { clientMessageId: 'a', content: 'hello', attachmentIds: [] },
    { clientMessageId: 'b', content: 'refund policy?', attachmentIds: [] },
  ],
};

const completed = {
  assistantMessageId: 'm',
  finishReason: 'stop',
  usage: { inputTokens: 1, outputTokens: 1 },
  timings: { ttftMs: 1, totalMs: 1 },
};

function createClient(fetchImplementation: typeof fetch, sessionStore = memorySessionStore()) {
  return new ChatApiClient({
    baseUrl: 'https://rag.example',
    sessionStore,
    fetchImplementation,
    obtainTurnstileToken: () => Promise.resolve(null),
    computeFingerprint: () => Promise.resolve('fp'),
    sleep: () => Promise.resolve(),
  });
}

describe('ChatApiClient.streamTurn', () => {
  it('posts the whole batch once with an Idempotency-Key and streams typed events', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        sse(1, 'message.started', {
          turnId: 'turn-1',
          conversationId: 'c',
          assistantMessageId: 'm',
          userMessages: [],
        }),
        // Split mid-event to prove chunk reassembly.
        'id: 2\nevent: answer.delta\nda',
        `ta: {"text":"Hi"}\n\n${sse(3, 'message.completed', completed)}`,
      ]),
    );
    const events: TurnStreamEvent[] = [];
    await createClient(fetchMock).streamTurn(
      'c',
      request,
      { onEvent: (e) => events.push(e) },
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://rag.example/v1/public/conversations/c/turns');
    const headers = new Headers(init?.headers);
    expect(headers.get('Idempotency-Key')).toBe('turn-1');
    expect(headers.get('Authorization')).toBe('Bearer token-1');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      messages: [{ content: 'hello' }, { content: 'refund policy?' }],
    });
    expect(events.map((e) => e.type)).toEqual(['message.started', 'answer.delta', 'message.completed']);
  });

  it('resumes a dropped stream from Last-Event-ID instead of re-posting the turn', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse(
          [
            sse(1, 'message.started', {
              turnId: 'turn-1',
              conversationId: 'c',
              assistantMessageId: 'm',
              userMessages: [],
            }),
            sse(2, 'answer.delta', { text: 'Hel' }),
          ],
          {
            dropAtEnd: true,
          },
        ),
      )
      .mockResolvedValueOnce(
        sseResponse([sse(3, 'answer.delta', { text: 'lo' }), sse(4, 'message.completed', completed)]),
      );
    const onReconnecting = vi.fn();
    const onReconnected = vi.fn();
    const text: string[] = [];

    await createClient(fetchMock).streamTurn(
      'c',
      request,
      { onEvent: (e) => e.type === 'answer.delta' && text.push(e.data.text), onReconnecting, onReconnected },
      new AbortController().signal,
    );

    expect(text.join('')).toBe('Hello');
    expect(onReconnecting).toHaveBeenCalledWith(1);
    expect(onReconnected).toHaveBeenCalledTimes(1);
    const [resumeUrl, resumeInit] = fetchMock.mock.calls[1]!;
    expect(resumeUrl).toBe('https://rag.example/v1/public/conversations/c/turns/turn-1/events');
    expect(new Headers(resumeInit?.headers).get('Last-Event-ID')).toBe('2');
  });

  it('retries the POST with the same Idempotency-Key when the connection fails before any event', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(sseResponse([sse(1, 'message.completed', completed)]));
    await createClient(fetchMock).streamTurn(
      'c',
      request,
      { onEvent: () => undefined },
      new AbortController().signal,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Idempotency-Key')).toBe('turn-1');
    expect(fetchMock.mock.calls[1]![1]?.method).toBe('POST');
  });

  it('surfaces 429 with Retry-After without retrying automatically', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(problem(429, 'rate_limited', { 'Retry-After': '8' }));
    const error = await createClient(fetchMock)
      .streamTurn('c', request, { onEvent: () => undefined }, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatApiError);
    expect(error).toMatchObject({ kind: 'rate_limited', retryAfterMs: 8000, status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured number of reconnect attempts', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const client = new ChatApiClient({
      baseUrl: '',
      sessionStore: memorySessionStore(),
      fetchImplementation: fetchMock,
      obtainTurnstileToken: () => Promise.resolve(null),
      computeFingerprint: () => Promise.resolve('fp'),
      maxStreamReconnectAttempts: 2,
      sleep: () => Promise.resolve(),
    });
    await expect(
      client.streamTurn('c', request, { onEvent: () => undefined }, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when aborted', async () => {
    const abort = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => {
      abort.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    await expect(
      createClient(fetchMock).streamTurn('c', request, { onEvent: () => undefined }, abort.signal),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ChatApiClient sessions', () => {
  it('creates a visitor session when none is stored', async () => {
    const store = memorySessionStore(null);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(SESSION), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null })));
    await createClient(fetchMock, store).listConversations();
    expect(fetchMock.mock.calls[0]![0]).toBe('https://rag.example/v1/public/sessions');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({
      turnstileToken: null,
      fingerprint: 'fp',
    });
    expect(store.current).toEqual(SESSION);
  });

  it('renews an expired session once on 401 and retries the request', async () => {
    const store = memorySessionStore();
    const renewed = { ...SESSION, sessionToken: 'token-2' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(problem(401, 'session_expired'))
      .mockResolvedValueOnce(new Response(JSON.stringify(renewed), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null })));
    await createClient(fetchMock, store).listConversations();
    expect(new Headers(fetchMock.mock.calls[2]![1]?.headers).get('Authorization')).toBe('Bearer token-2');
  });

  it('rejects responses that violate the contract', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ items: 'nope' })));
    await expect(createClient(fetchMock).listConversations()).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('contract details', () => {
  it('treats turn.superseded as the end of the stream and reports it', async () => {
    const events: TurnStreamEvent[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse([sse(1, 'turn.superseded', { supersededByTurnId: 'turn-2' })]));
    await createClient(fetchMock).streamTurn(
      'c',
      request,
      { onEvent: (event) => events.push(event) },
      new AbortController().signal,
    );
    expect(events.map((e) => e.type)).toEqual(['turn.superseded']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tags every request with an X-Request-ID', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null })));
    const client = new ChatApiClient({
      baseUrl: 'https://rag.example',
      sessionStore: memorySessionStore(),
      fetchImplementation: fetchMock,
      createRequestId: () => 'request-1',
      obtainTurnstileToken: () => Promise.resolve(null),
      computeFingerprint: () => Promise.resolve('fp'),
    });
    await client.listConversations();
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('X-Request-ID')).toBe('request-1');
  });

  it('sends the configured default headers (the widget key) with every request', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null })));
    const client = new ChatApiClient({
      baseUrl: 'https://rag.example',
      sessionStore: memorySessionStore(),
      fetchImplementation: fetchMock,
      defaultHeaders: { 'X-Widget-Key': 'pk_test' },
      obtainTurnstileToken: () => Promise.resolve(null),
      computeFingerprint: () => Promise.resolve('fp'),
    });
    await client.listConversations();
    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.get('X-Widget-Key')).toBe('pk_test');
    expect(headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('pages history backwards with before and limit', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: 'older' })));
    const page = await createClient(fetchMock).listMessages('conv', { before: 'msg-9', limit: 20 });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://rag.example/v1/public/conversations/conv/messages?before=msg-9&limit=20',
    );
    expect(page.nextCursor).toBe('older');
  });

  it('reads RFC 9457 problem details, including the request id and field errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 422,
          code: 'validation_failed',
          detail: 'Invalid turn',
          requestId: 'req-42',
          errors: [{ field: 'messages', message: 'too many' }],
        }),
        { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    );
    const error = await createClient(fetchMock)
      .createConversation()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ChatApiError);
    expect(error).toMatchObject({ kind: 'validation', requestId: 'req-42', message: 'Invalid turn' });
    expect((error as ChatApiError).details.fieldErrors).toEqual([{ field: 'messages', message: 'too many' }]);
  });

  it('announces a replaced session so the UI can drop conversations of the old one', async () => {
    const onSessionReplaced = vi.fn();
    const store = memorySessionStore();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(problem(401, 'session_expired'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...SESSION, sessionToken: 'token-2' }), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null })));
    const client = new ChatApiClient({
      baseUrl: 'https://rag.example',
      sessionStore: store,
      fetchImplementation: fetchMock,
      onSessionReplaced,
      obtainTurnstileToken: () => Promise.resolve(null),
      computeFingerprint: () => Promise.resolve('fp'),
    });
    await client.listConversations();
    expect(onSessionReplaced).toHaveBeenCalledTimes(1);
  });
});

describe('public config', () => {
  const config = {
    botName: 'Assistant',
    greeting: 'Hello',
    suggestedPrompts: [],
    turnstileSiteKey: null,
    limits: {
      maxImageBytes: 1,
      allowedImageTypes: [],
      maxImagesPerTurn: 1,
      maxMessagesPerTurn: 1,
      maxMessageChars: 1,
    },
    features: { reasoning: false, feedback: true },
  };

  it('reads the admin showSources setting', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ...config, showSources: false })));
    expect((await createClient(fetchMock).getConfig()).showSources).toBe(false);
  });

  it('defaults showSources to true for a rag that does not send it', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(config)));
    expect((await createClient(fetchMock).getConfig()).showSources).toBe(true);
  });
});

describe('helpers', () => {
  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfterHeader('5')).toBe(5000);
    expect(
      parseRetryAfterHeader('Wed, 21 Oct 2015 07:28:10 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT')),
    ).toBe(10_000);
    expect(parseRetryAfterHeader(null)).toBeUndefined();
    expect(parseRetryAfterHeader('soon')).toBeUndefined();
  });

  it('backs off exponentially with jitter, capped at 8 s', () => {
    expect(reconnectDelayMs(1, () => 0)).toBe(250);
    expect(reconnectDelayMs(1, () => 1)).toBe(500);
    expect(reconnectDelayMs(3, () => 1)).toBe(2000);
    expect(reconnectDelayMs(10, () => 1)).toBe(8000);
  });
});
