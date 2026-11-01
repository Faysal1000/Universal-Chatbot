import { z } from 'zod';

import { CHUNK_KINDS } from '../../database/schema.js';

/** What retrieval did for one turn, stored in `retrieval_traces` for debugging. */
export interface RetrievalTrace {
  readonly indexVersionId: number | null;
  readonly searchQueries: string[];
  readonly imageQueryCount: number;
  /** Per query (text queries first, then image queries): ranked embedding (dense) and keyword (sparse) hits. */
  readonly searches: {
    readonly dense: TracedHit[];
    readonly sparse: TracedHit[];
  }[];
  readonly fused: TracedFusedHit[];
  readonly selectedChunkIds: string[];
  /** The sources sent to the model, in source-number order. */
  readonly selected: TracedSource[];
  readonly bestDenseSimilarity: number | null;
  readonly minSimilarity: number;
  readonly outcome: 'answerable' | 'no_evidence';
  readonly timingsMilliseconds: {
    readonly embedding: number;
    readonly search: number;
    readonly total: number;
  };
}

export interface TracedHit {
  readonly chunkId: string;
  readonly score: number;
}

/** A fused rank: `score` is the RRF sum; the per-signal scores are the best over all queries. */
export interface TracedFusedHit extends TracedHit {
  readonly denseSimilarity: number | null;
  readonly keywordScore: number | null;
}

export interface TracedSource {
  readonly chunkId: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly chunkKind: (typeof CHUNK_KINDS)[number];
  readonly pageStart: number;
  readonly pageEnd: number;
  readonly fusedScore: number;
  readonly denseSimilarity: number | null;
}

const tracedHitSchema = z.object({ chunkId: z.string(), score: z.number() });

/**
 * A stored trace as the admin API returns it. Fields added after the first release are
 * optional, because traces written before them are still returned as stored.
 */
export const retrievalTraceSchema = z.object({
  indexVersionId: z.number().int().nullable(),
  searchQueries: z.array(z.string()),
  imageQueryCount: z.number().int(),
  searches: z.array(z.object({ dense: z.array(tracedHitSchema), sparse: z.array(tracedHitSchema) })),
  fused: z.array(
    tracedHitSchema.extend({
      denseSimilarity: z.number().nullable().optional(),
      keywordScore: z.number().nullable().optional(),
    }),
  ),
  selectedChunkIds: z.array(z.string()),
  selected: z
    .array(
      z.object({
        chunkId: z.string(),
        documentId: z.string(),
        documentTitle: z.string(),
        chunkKind: z.enum(CHUNK_KINDS),
        pageStart: z.number().int(),
        pageEnd: z.number().int(),
        fusedScore: z.number(),
        denseSimilarity: z.number().nullable(),
      }),
    )
    .optional(),
  bestDenseSimilarity: z.number().nullable(),
  minSimilarity: z.number(),
  outcome: z.enum(['answerable', 'no_evidence']),
  timingsMilliseconds: z.object({ embedding: z.number(), search: z.number(), total: z.number() }),
});
