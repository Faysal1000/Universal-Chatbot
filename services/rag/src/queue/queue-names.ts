/**
 * Every BullMQ queue in the platform. `parse.*` queues are consumed by the Python
 * document-parser, so their names and payloads are part of the cross-service contract
 * in `services/rag/contracts/`. Renaming one is a breaking change.
 */
export const QUEUE_NAMES = {
  parseInspect: 'parse.inspect',
  parsePages: 'parse.pages',
  ingestPlan: 'ingest.plan',
  ingestAssemble: 'ingest.assemble',
  ingestChunk: 'ingest.chunk',
  ingestEmbedIndex: 'ingest.embed_index',
  ingestFinalize: 'ingest.finalize',
  documentDelete: 'document.delete',
  indexRebuild: 'index.rebuild',
  conversationSummary: 'chat.summarise',
  maintenance: 'maintenance',
  deadLetter: 'dead-letter',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
