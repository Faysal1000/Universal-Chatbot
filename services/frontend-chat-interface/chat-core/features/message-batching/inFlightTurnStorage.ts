import { z } from 'zod';

import { attachmentSchema } from '@chat-core/api/chatApiContract';
import type { PendingUserMessage } from '@chat-core/features/chat/chatThreadModel';

const inFlightTurnSchema = z.object({
  turnId: z.string(),
  conversationKey: z.string(),
  messages: z.array(
    z.object({
      clientMessageId: z.string(),
      content: z.string(),
      attachments: z.array(attachmentSchema),
      createdAt: z.string(),
    }),
  ),
});
export type InFlightTurnRecord = z.infer<typeof inFlightTurnSchema>;

/**
 * A flushed batch stays recorded here until the server acknowledges it (`message.started`).
 *
 * Closing or reloading the tab fires `visibilitychange: hidden` (which flushes) right before unload kills the
 * request, so without this record those messages would be lost. On the next start each record is resubmitted
 * with the SAME turn id: the backend's Idempotency-Key handling replays the turn if it did arrive, so this
 * can never produce a duplicate answer.
 */
export interface InFlightTurnStorage {
  loadAll(): InFlightTurnRecord[];
  save(record: { turnId: string; conversationKey: string; messages: readonly PendingUserMessage[] }): void;
  remove(turnId: string): void;
}

export function createInFlightTurnStorage(keyPrefix: string): InFlightTurnStorage {
  const storageKey = `${keyPrefix}.inFlightTurns.v1`;

  const loadAll = (): InFlightTurnRecord[] => {
    try {
      const parsed = z
        .array(inFlightTurnSchema)
        .safeParse(JSON.parse(localStorage.getItem(storageKey) ?? '[]'));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  };

  const write = (records: InFlightTurnRecord[]): void => {
    try {
      if (records.length === 0) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(records));
    } catch {
      // Storage unavailable: degrade to in-memory behaviour.
    }
  };

  return {
    loadAll,
    save(record) {
      write([
        ...loadAll().filter((r) => r.turnId !== record.turnId),
        { ...record, messages: [...record.messages] },
      ]);
    },
    remove(turnId) {
      write(loadAll().filter((r) => r.turnId !== turnId));
    },
  };
}
