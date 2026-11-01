import { z } from 'zod';

import { attachmentSchema } from '@chat-core/api/chatApiContract';
import type { PendingUserMessage } from '@chat-core/features/chat/chatThreadModel';
import { omitKey } from '@chat-core/shared/omitKey';

const storedBatchesSchema = z.record(
  z.string(),
  z.array(
    z.object({
      clientMessageId: z.string(),
      content: z.string(),
      attachments: z.array(attachmentSchema),
      createdAt: z.string(),
    }),
  ),
);

export interface PendingBatchStorage {
  loadAll(): Record<string, PendingUserMessage[]>;
  save(conversationKey: string, messages: readonly PendingUserMessage[]): void;
}

/**
 * Persists messages still waiting in a quiet window, so closing or reloading the tab never loses them.
 * They are restored (and sent after a fresh window) the next time the app opens. `keyPrefix` keeps two
 * embeddings on one origin (the chat app, a website widget) apart.
 */
export function createPendingBatchStorage(keyPrefix: string): PendingBatchStorage {
  const storageKey = `${keyPrefix}.pendingBatches.v1`;
  const storage: PendingBatchStorage = {
    loadAll() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return {};
        const parsed = storedBatchesSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : {};
      } catch {
        return {};
      }
    },

    save(conversationKey, messages) {
      try {
        const others = omitKey(storage.loadAll(), conversationKey);
        const all = messages.length === 0 ? others : { ...others, [conversationKey]: [...messages] };
        if (Object.keys(all).length === 0) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify(all));
      } catch {
        // Storage full or unavailable (private mode): batching still works in memory.
      }
    },
  };
  return storage;
}
