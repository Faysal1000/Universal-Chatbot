import { isTurnStreamEventName, turnStreamEventSchemas, type TurnStreamEvent } from './chatApiContract';
import type { ServerSentEvent } from './sseStreamParser';

export type DecodeResult =
  | { kind: 'event'; event: TurnStreamEvent }
  | { kind: 'ignored'; reason: 'unknown_event' }
  | { kind: 'invalid'; eventName: string; reason: string };

/**
 * Validates a raw SSE event against the contract. Unknown event names are ignored (forward compatibility:
 * the backend may add events), malformed payloads of known events are reported so they can be logged.
 */
export function decodeTurnStreamEvent(raw: ServerSentEvent): DecodeResult {
  if (!isTurnStreamEventName(raw.event)) return { kind: 'ignored', reason: 'unknown_event' };

  let json: unknown;
  try {
    json = JSON.parse(raw.data);
  } catch {
    return { kind: 'invalid', eventName: raw.event, reason: 'data is not valid JSON' };
  }

  const parsed = turnStreamEventSchemas[raw.event].safeParse(json);
  if (!parsed.success) return { kind: 'invalid', eventName: raw.event, reason: parsed.error.message };

  return { kind: 'event', event: { type: raw.event, eventId: raw.id, data: parsed.data } as TurnStreamEvent };
}
