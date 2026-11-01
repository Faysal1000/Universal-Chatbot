import { apiPaths } from './apiPaths';
import type { SubmitTurnRequest, TurnStreamEvent } from './chatApiContract';
import { ChatApiError } from './chatApiError';
import { SseStreamParser } from './sseStreamParser';
import { decodeTurnStreamEvent } from './turnStreamDecoder';

export interface StreamTurnHandlers {
  onEvent: (event: TurnStreamEvent) => void;
  /** Called before each reconnect attempt after a dropped connection (1-based). */
  onReconnecting?: (attempt: number) => void;
  /** Called once the stream is flowing again after a reconnect. */
  onReconnected?: () => void;
  /** Contract violations are skipped, not fatal; surfaced for logging. */
  onInvalidEvent?: (eventName: string, reason: string) => void;
}

export interface TurnEventStreamOptions {
  /** Sends an authorised request (the visitor session is handled by the caller). */
  send: (path: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Resume attempts after a dropped stream before giving up. */
  maxReconnectAttempts: number;
  random?: () => number;
}

/** Events after which the server closes the stream. */
const TERMINAL_EVENTS = new Set<TurnStreamEvent['type']>(['message.completed', 'error', 'turn.superseded']);

const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 8000;

/** Exponential backoff with jitter in the upper half: ceilings of 0.5 s, 1 s, 2 s, 4 s … capped at 8 s. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

function isTransientStreamFailure(error: unknown): boolean {
  return (
    error instanceof ChatApiError && ['network', 'stream_interrupted', 'unavailable'].includes(error.kind)
  );
}

/**
 * Runs one turn's SSE stream to its terminal event (`message.completed`, `error` or `turn.superseded`).
 *
 * Dropped connections are resumed from the last event id (`GET …/events` + `Last-Event-ID`); the server keeps
 * generating for a grace period after a disconnect, so nothing is lost. A POST that failed before any event is
 * retried with the same `Idempotency-Key`, so the backend never runs the turn twice.
 */
export async function runTurnEventStream(
  options: TurnEventStreamOptions,
  target: { conversationId: string; turnId: string; submission: SubmitTurnRequest | null },
  handlers: StreamTurnHandlers,
  signal: AbortSignal,
): Promise<void> {
  const { conversationId, turnId, submission } = target;
  // Mutated inside the event callback; an object keeps TypeScript from narrowing it to `null`.
  const cursor: { lastEventId: string | null; started: boolean } = {
    lastEventId: null,
    started: submission === null,
  };
  let failedAttempts = 0;

  const openStream = () =>
    cursor.started || submission === null
      ? options.send(apiPaths.turnEvents(conversationId, turnId), {
          headers: { Accept: 'text/event-stream', 'Last-Event-ID': cursor.lastEventId ?? '0' },
          signal,
        })
      : options.send(apiPaths.turns(conversationId), {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            'Idempotency-Key': submission.turnId,
          },
          body: JSON.stringify(submission),
          signal,
        });

  for (;;) {
    try {
      const response = await openStream();
      if (failedAttempts > 0) handlers.onReconnected?.();
      const finished = await consumeEventStream(
        response,
        signal,
        (event, eventId) => {
          cursor.started = true;
          failedAttempts = 0;
          if (eventId !== null) cursor.lastEventId = eventId;
          handlers.onEvent(event);
        },
        handlers.onInvalidEvent,
      );
      if (finished) return;
      throw new ChatApiError('stream_interrupted', 'The answer stream ended unexpectedly.');
    } catch (error) {
      if (signal.aborted) throw error;
      if (!isTransientStreamFailure(error) || failedAttempts >= options.maxReconnectAttempts) throw error;
      failedAttempts += 1;
      handlers.onReconnecting?.(failedAttempts);
      const serverDelay = error instanceof ChatApiError ? error.retryAfterMs : undefined;
      await options.sleep(serverDelay ?? reconnectDelayMs(failedAttempts, options.random), signal);
    }
  }
}

/** Reads SSE frames until a terminal event. Returns false when the connection closed before one arrived. */
async function consumeEventStream(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: TurnStreamEvent, eventId: string | null) => void,
  onInvalidEvent?: (eventName: string, reason: string) => void,
): Promise<boolean> {
  if (!response.body) throw new ChatApiError('stream_interrupted', 'The server returned an empty stream.');
  const parser = new SseStreamParser();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const cancelReader = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancelReader, { once: true });

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch (cause) {
        if (signal.aborted) throw signal.reason as Error;
        throw new ChatApiError('stream_interrupted', 'The connection dropped while streaming.', { cause });
      }
      if (chunk.done) return false;

      for (const raw of parser.push(chunk.value)) {
        const decoded = decodeTurnStreamEvent(raw);
        if (decoded.kind === 'invalid') onInvalidEvent?.(decoded.eventName, decoded.reason);
        if (decoded.kind !== 'event') continue;
        onEvent(decoded.event, raw.id);
        if (TERMINAL_EVENTS.has(decoded.event.type)) {
          cancelReader();
          return true;
        }
      }
    }
  } finally {
    signal.removeEventListener('abort', cancelReader);
  }
}
