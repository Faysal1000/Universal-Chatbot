import { createInFlightTurnStorage, type InFlightTurnStorage } from './inFlightTurnStorage';
import { createPendingBatchStorage, type PendingBatchStorage } from './pendingBatchStorage';

/** The quiet-window timing every embedding of the chat configures (see MessageBatchScheduler). */
export interface BatchingConfig {
  quietWindowMinMs: number;
  quietWindowMaxMs: number;
  maxWaitMs: number;
}

/** A short random pause gathers quick follow-up messages into one turn without feeling slow. */
export const DEFAULT_BATCHING: BatchingConfig = {
  quietWindowMinMs: 1_000,
  quietWindowMaxMs: 2_000,
  maxWaitMs: 10_000,
};

/** What survives a reload: messages still in their quiet window, and batches sent but not yet acknowledged. */
export interface ChatPersistence {
  pendingBatches: PendingBatchStorage;
  inFlightTurns: InFlightTurnStorage;
}

/** localStorage-backed persistence; every key starts with `keyPrefix` so embeddings on one origin stay apart. */
export function createBrowserChatPersistence(keyPrefix: string): ChatPersistence {
  return {
    pendingBatches: createPendingBatchStorage(keyPrefix),
    inFlightTurns: createInFlightTurnStorage(keyPrefix),
  };
}
