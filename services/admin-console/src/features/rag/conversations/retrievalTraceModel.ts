/**
 * Reads the retrieval trace the rag service stores per turn (`retrieval-trace.ts` in
 * services/rag). Traces are stored JSON kept for weeks, so one written by an older service
 * version may lack newer fields: it is parsed defensively, missing parts read as empty, and an
 * unreadable trace degrades to `null` instead of breaking the page.
 */
import { isRecord, type UnknownRecord } from '@/shared/lib/unknownRecord';

import { formatSimilarity } from './retrievalScoreFormat';

interface TracedHit {
  chunkId: string;
  score: number;
}

interface QuerySearch {
  dense: TracedHit[];
  sparse: TracedHit[];
}

type RetrievalOutcome = 'answerable' | 'no_evidence';

/** A chunk sent to the model as a source, with where it came from. */
export interface SelectedSource {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkKind: 'text' | 'visual';
  pageStart: number;
  pageEnd: number;
  fusedScore: number;
  denseSimilarity: number | null;
}

export interface RetrievalTrace {
  indexVersionId: number | null;
  searchQueries: string[];
  imageQueryCount: number;
  /** Text queries first, then image queries, in the order of `searchQueries`. */
  searches: QuerySearch[];
  /** Top fused (RRF) ranks, best first. */
  fused: TracedHit[];
  /** Chunks sent to the model as sources, in source-number order. */
  selectedChunkIds: string[];
  /** The same sources with their documents and pages; empty in traces from before rag recorded them. */
  selected: SelectedSource[];
  bestDenseSimilarity: number | null;
  minSimilarity: number;
  outcome: RetrievalOutcome;
  timingsMilliseconds: { embedding: number; search: number; total: number };
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readHits(value: unknown): TracedHit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown): TracedHit[] =>
    isRecord(entry) && typeof entry.chunkId === 'string' && typeof entry.score === 'number'
      ? [{ chunkId: entry.chunkId, score: entry.score }]
      : [],
  );
}

function readSelectedSources(value: unknown): SelectedSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown): SelectedSource[] => {
    if (!isRecord(entry)) return [];
    const { chunkId, documentId, documentTitle, chunkKind, pageStart, pageEnd, fusedScore } = entry;
    const isReadable =
      typeof chunkId === 'string' &&
      typeof documentId === 'string' &&
      typeof documentTitle === 'string' &&
      (chunkKind === 'text' || chunkKind === 'visual') &&
      typeof pageStart === 'number' &&
      typeof pageEnd === 'number' &&
      typeof fusedScore === 'number';
    if (!isReadable) return [];
    const denseSimilarity = readNullableNumber(entry.denseSimilarity);
    return [{ chunkId, documentId, documentTitle, chunkKind, pageStart, pageEnd, fusedScore, denseSimilarity }];
  });
}

function readSearches(value: unknown): QuerySearch[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry: unknown) =>
    isRecord(entry) ? { dense: readHits(entry.dense), sparse: readHits(entry.sparse) } : { dense: [], sparse: [] },
  );
}

function readTimings(value: unknown): RetrievalTrace['timingsMilliseconds'] {
  const timings = isRecord(value) ? value : {};
  return {
    embedding: readNumber(timings.embedding, 0),
    search: readNumber(timings.search, 0),
    total: readNumber(timings.total, 0),
  };
}

/** The stored trace as a typed value, or `null` when the turn has none or it is unreadable. */
export function parseRetrievalTrace(rawTrace: UnknownRecord | null): RetrievalTrace | null {
  if (rawTrace === null || typeof rawTrace.minSimilarity !== 'number') return null;
  if (rawTrace.outcome !== 'answerable' && rawTrace.outcome !== 'no_evidence') return null;
  return {
    indexVersionId: readNullableNumber(rawTrace.indexVersionId),
    searchQueries: readStrings(rawTrace.searchQueries),
    imageQueryCount: readNumber(rawTrace.imageQueryCount, 0),
    searches: readSearches(rawTrace.searches),
    fused: readHits(rawTrace.fused),
    selectedChunkIds: readStrings(rawTrace.selectedChunkIds),
    selected: readSelectedSources(rawTrace.selected),
    bestDenseSimilarity: readNullableNumber(rawTrace.bestDenseSimilarity),
    minSimilarity: rawTrace.minSimilarity,
    outcome: rawTrace.outcome,
    timingsMilliseconds: readTimings(rawTrace.timingsMilliseconds),
  };
}

/** One searched query: what was searched and what each search found. */
export interface QuerySearchRow {
  label: string;
  isImageQuery: boolean;
  denseHitCount: number;
  topDenseSimilarity: number | null;
  sparseHitCount: number;
  topKeywordScore: number | null;
}

function topScore(hits: readonly TracedHit[]): number | null {
  return hits.length === 0 ? null : Math.max(...hits.map((hit) => hit.score));
}

export function buildQuerySearchRows(trace: RetrievalTrace): QuerySearchRow[] {
  return trace.searches.map((search, searchIndex) => {
    const isImageQuery = searchIndex >= trace.searchQueries.length;
    const imageNumber = searchIndex - trace.searchQueries.length + 1;
    return {
      label: isImageQuery ? `Attached image ${imageNumber}` : (trace.searchQueries[searchIndex] ?? ''),
      isImageQuery,
      denseHitCount: search.dense.length,
      topDenseSimilarity: topScore(search.dense),
      sparseHitCount: search.sparse.length,
      topKeywordScore: topScore(search.sparse),
    };
  });
}

/** One retrieved chunk with its scores from every stage. */
export interface ChunkScoreRow {
  chunkId: string;
  fusedRank: number | null;
  fusedScore: number | null;
  /** Best cosine similarity over every query's dense search. */
  bestDenseSimilarity: number | null;
  /** Best (lowest) 1-based rank over every query's dense search. */
  bestDenseRank: number | null;
  bestKeywordScore: number | null;
  bestSparseRank: number | null;
  /** 1-based source number given to the model, or null when not selected. */
  sourceNumber: number | null;
}

interface BestHit {
  score: number;
  rank: number;
}

function bestHitsByChunk(hitLists: readonly (readonly TracedHit[])[]): Map<string, BestHit> {
  const bestHits = new Map<string, BestHit>();
  for (const hits of hitLists) {
    hits.forEach((hit, hitIndex) => {
      const previous = bestHits.get(hit.chunkId);
      bestHits.set(hit.chunkId, {
        score: Math.max(previous?.score ?? -Infinity, hit.score),
        rank: Math.min(previous?.rank ?? Infinity, hitIndex + 1),
      });
    });
  }
  return bestHits;
}

/** Fused ranks first (best first), then any selected chunk outside the traced fused ranks. */
function orderedChunkIds(trace: RetrievalTrace): string[] {
  const fusedChunkIds = trace.fused.map((hit) => hit.chunkId);
  const selectedOutsideFused = trace.selectedChunkIds.filter((chunkId) => !fusedChunkIds.includes(chunkId));
  return [...fusedChunkIds, ...selectedOutsideFused];
}

export function buildChunkScoreRows(trace: RetrievalTrace): ChunkScoreRow[] {
  const bestDense = bestHitsByChunk(trace.searches.map((search) => search.dense));
  const bestSparse = bestHitsByChunk(trace.searches.map((search) => search.sparse));
  const fusedRanks = new Map(
    trace.fused.map((hit, hitIndex) => [hit.chunkId, { rank: hitIndex + 1, score: hit.score }]),
  );
  return orderedChunkIds(trace).map((chunkId) => {
    const selectedIndex = trace.selectedChunkIds.indexOf(chunkId);
    return {
      chunkId,
      fusedRank: fusedRanks.get(chunkId)?.rank ?? null,
      fusedScore: fusedRanks.get(chunkId)?.score ?? null,
      bestDenseSimilarity: bestDense.get(chunkId)?.score ?? null,
      bestDenseRank: bestDense.get(chunkId)?.rank ?? null,
      bestKeywordScore: bestSparse.get(chunkId)?.score ?? null,
      bestSparseRank: bestSparse.get(chunkId)?.rank ?? null,
      sourceNumber: selectedIndex === -1 ? null : selectedIndex + 1,
    };
  });
}

/** The `min_similarity` gate in one sentence: what was compared and what followed. */
export function describeSimilarityDecision(trace: RetrievalTrace): string {
  const threshold = formatSimilarity(trace.minSimilarity);
  if (trace.indexVersionId === null) return 'Nothing was searched: no index version was live.';
  if (trace.bestDenseSimilarity === null) {
    return `No source had a dense similarity, so the minimum ${threshold} was not reached; the fallback message was sent.`;
  }
  const best = formatSimilarity(trace.bestDenseSimilarity);
  return trace.outcome === 'answerable'
    ? `Best dense similarity ${best} reached the minimum ${threshold}; the answer was generated from ${trace.selectedChunkIds.length} sources.`
    : `Best dense similarity ${best} is below the minimum ${threshold}; the fallback message was sent.`;
}

/** The first block of a UUID: enough to tell rows apart in a dense table. */
export function shortUuid(uuid: string): string {
  return uuid.split('-')[0] ?? uuid;
}

/** "p. 4" or "pp. 4–6". */
export function describePageRange(source: Pick<SelectedSource, 'pageStart' | 'pageEnd'>): string {
  return source.pageStart === source.pageEnd ? `p. ${source.pageStart}` : `pp. ${source.pageStart}–${source.pageEnd}`;
}
