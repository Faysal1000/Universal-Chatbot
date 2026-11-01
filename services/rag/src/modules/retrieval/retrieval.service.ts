import { Inject, Injectable } from '@nestjs/common';

import { toSearchQuery } from '../../domain/lexical/search-terms.js';
import { fuseRankedLists, type RankedList } from '../../domain/retrieval/reciprocal-rank-fusion.js';
import { removeDuplicateSources } from '../../domain/retrieval/source-deduplication.js';
import { EMBEDDING_PORT, type EmbeddingInput, type EmbeddingPort } from '../../ports/embedding.port.js';
import { ChunkVectorsRepository, type SearchHit } from '../index-versions/chunk-vectors.repository.js';
import { ChunksRepository, type HydratedChunk } from '../index-versions/chunks.repository.js';
import { LiveIndexService } from '../index-versions/live-index.service.js';
import type { RetrievalTrace, TracedSource } from './retrieval-trace.js';

/** Hits fetched from each of the embedding and the term search, per query. */
const CANDIDATES_PER_SEARCH = 40;
/** Fused candidates hydrated from Postgres per wanted source, so filtering still leaves enough. */
const HYDRATION_FACTOR = 3;
/** Fused ranks kept in the trace for debugging. */
const TRACED_FUSED_RANKS = 30;

export interface RetrievalRequest {
  /** Standalone search queries (1–3) from query rewriting, or the raw question. */
  readonly searchQueries: readonly string[];
  /** Images the visitor attached, searched as text+image queries in the shared space. */
  readonly queryImagesBase64?: readonly string[];
  readonly maxSources: number;
  /** Dense cosine similarity a source must reach to be sent to the model. */
  readonly minSimilarity: number;
  readonly abortSignal?: AbortSignal;
}

export interface RetrievedSource {
  readonly chunk: HydratedChunk;
  readonly fusedScore: number;
  /** This chunk's best dense cosine similarity over all queries, when a dense search found it. */
  readonly denseSimilarity: number | null;
}

export interface RetrievalResult {
  /** `no_evidence` when no source reaches `minSimilarity`; the bot then sends its fallback message. */
  readonly outcome: 'answerable' | 'no_evidence';
  readonly sources: readonly RetrievedSource[];
  readonly bestDenseSimilarity: number | null;
  readonly trace: RetrievalTrace;
}

/** Ranked hits of one query's two searches. */
interface CandidateSearchResult {
  readonly denseHits: readonly SearchHit[];
  readonly sparseHits: readonly SearchHit[];
}

/**
 * Hybrid retrieval in Postgres: per query a pgvector embedding search and a full-text
 * term search, fused with Reciprocal Rank Fusion, hydrated and deduplicated.
 */
@Injectable()
export class RetrievalService {
  constructor(
    private readonly liveIndex: LiveIndexService,
    private readonly chunksRepository: ChunksRepository,
    private readonly chunkVectorsRepository: ChunkVectorsRepository,
    @Inject(EMBEDDING_PORT) private readonly embeddingPort: EmbeddingPort,
  ) {}

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const startedAt = performance.now();
    const liveVersion = await this.liveIndex.findLiveVersion();
    if (liveVersion === undefined) return emptyResult(request, performance.now() - startedAt);
    const queryInputs = toQueryInputs(request);
    const { vectors } = await this.embeddingPort.embedQueries(queryInputs, request.abortSignal);
    const embeddedAt = performance.now();
    const searchResults = await Promise.all(
      queryInputs.map((queryInput, index) =>
        this.searchCandidates(liveVersion.id, vectors[index] ?? [], queryInput),
      ),
    );
    const searchedAt = performance.now();
    const fusedItems = fuseRankedLists(searchResults.flatMap(toRankedLists));
    const denseSimilarities = bestScoreByChunk(searchResults.flatMap((result) => result.denseHits));
    const keywordScores = bestScoreByChunk(searchResults.flatMap((result) => result.sparseHits));
    const candidates = await this.hydrateRankedSources(fusedItems, denseSimilarities, request.maxSources);
    const bestDenseSimilarity = maximumOf(candidates.map((source) => source.denseSimilarity));
    const sources = candidates
      .filter((source) => (source.denseSimilarity ?? 0) >= request.minSimilarity)
      .slice(0, request.maxSources);
    const isAnswerable = sources.length > 0;
    return {
      outcome: isAnswerable ? 'answerable' : 'no_evidence',
      sources,
      bestDenseSimilarity,
      trace: {
        indexVersionId: liveVersion.id,
        searchQueries: [...request.searchQueries],
        imageQueryCount: request.queryImagesBase64?.length ?? 0,
        searches: searchResults.map((result) => ({
          dense: result.denseHits.map(toTracedHit),
          sparse: result.sparseHits.map(toTracedHit),
        })),
        fused: fusedItems.slice(0, TRACED_FUSED_RANKS).map((item) => ({
          chunkId: item.itemId,
          score: item.fusedScore,
          denseSimilarity: denseSimilarities.get(item.itemId) ?? null,
          keywordScore: keywordScores.get(item.itemId) ?? null,
        })),
        selectedChunkIds: sources.map((source) => source.chunk.id),
        selected: sources.map(toTracedSource),
        bestDenseSimilarity,
        minSimilarity: request.minSimilarity,
        outcome: isAnswerable ? 'answerable' : 'no_evidence',
        timingsMilliseconds: {
          embedding: Math.round(embeddedAt - startedAt),
          search: Math.round(searchedAt - embeddedAt),
          total: Math.round(performance.now() - startedAt),
        },
      },
    };
  }

  private async searchCandidates(
    indexVersionId: number,
    embedding: readonly number[],
    queryInput: EmbeddingInput,
  ): Promise<CandidateSearchResult> {
    const searchQuery = queryInput.kind === 'text' ? toSearchQuery(queryInput.text) : undefined;
    const [denseHits, sparseHits] = await Promise.all([
      this.chunkVectorsRepository.searchByEmbedding(indexVersionId, embedding, CANDIDATES_PER_SEARCH),
      searchQuery === undefined
        ? []
        : this.chunkVectorsRepository.searchByTerms(indexVersionId, searchQuery, CANDIDATES_PER_SEARCH),
    ]);
    return { denseHits, sparseHits };
  }

  /** Candidates in fused order, minus disabled documents and duplicates. */
  private async hydrateRankedSources(
    fusedItems: readonly { itemId: string; fusedScore: number }[],
    denseSimilarities: ReadonlyMap<string, number>,
    maxSources: number,
  ): Promise<RetrievedSource[]> {
    const candidates = fusedItems.slice(0, maxSources * HYDRATION_FACTOR);
    const chunksById = new Map(
      (await this.chunksRepository.hydrate(candidates.map((item) => item.itemId))).map((chunk) => [
        chunk.id,
        chunk,
      ]),
    );
    const rankedSources = candidates.flatMap((item): RetrievedSource[] => {
      const chunk = chunksById.get(item.itemId);
      if (chunk?.isDocumentEnabled !== true) return [];
      return [
        { chunk, fusedScore: item.fusedScore, denseSimilarity: denseSimilarities.get(chunk.id) ?? null },
      ];
    });
    const uniqueSources = removeDuplicateSources(
      rankedSources.map((source) => ({
        source,
        chunkId: source.chunk.id,
        contentHash: source.chunk.contentHash,
        blockIds: source.chunk.blockIds,
      })),
    );
    return uniqueSources.map((candidate) => candidate.source);
  }
}

function toQueryInputs(request: RetrievalRequest): EmbeddingInput[] {
  const searchQueries = request.searchQueries.map((text) => text.trim()).filter((text) => text !== '');
  const textQueries = searchQueries.map((text): EmbeddingInput => ({ kind: 'text', text }));
  const [leadQuery = ''] = searchQueries;
  const imageQueries = (request.queryImagesBase64 ?? []).map((imageBase64): EmbeddingInput =>
    leadQuery === '' ? { kind: 'image', imageBase64 } : { kind: 'text_image', text: leadQuery, imageBase64 },
  );
  return [...textQueries, ...imageQueries];
}

function toRankedLists(result: CandidateSearchResult): RankedList[] {
  return [
    { itemIds: result.denseHits.map((hit) => hit.chunkId) },
    { itemIds: result.sparseHits.map((hit) => hit.chunkId) },
  ];
}

/** Each chunk's best score over all queries' hits of one kind (dense or sparse). */
function bestScoreByChunk(hits: readonly SearchHit[]): Map<string, number> {
  const bestScores = new Map<string, number>();
  for (const hit of hits) {
    const bestSoFar = bestScores.get(hit.chunkId);
    bestScores.set(hit.chunkId, bestSoFar === undefined ? hit.score : Math.max(bestSoFar, hit.score));
  }
  return bestScores;
}

function toTracedSource({ chunk, fusedScore, denseSimilarity }: RetrievedSource): TracedSource {
  return {
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    chunkKind: chunk.chunkKind,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    fusedScore,
    denseSimilarity,
  };
}

function maximumOf(values: readonly (number | null)[]): number | null {
  const presentValues = values.filter((value): value is number => value !== null);
  return presentValues.length === 0 ? null : Math.max(...presentValues);
}

function toTracedHit(hit: SearchHit): { chunkId: string; score: number } {
  return { chunkId: hit.chunkId, score: hit.score };
}

function emptyResult(request: RetrievalRequest, elapsedMilliseconds: number): RetrievalResult {
  return {
    outcome: 'no_evidence',
    sources: [],
    bestDenseSimilarity: null,
    trace: {
      indexVersionId: null,
      searchQueries: [...request.searchQueries],
      imageQueryCount: request.queryImagesBase64?.length ?? 0,
      searches: [],
      fused: [],
      selectedChunkIds: [],
      selected: [],
      bestDenseSimilarity: null,
      minSimilarity: request.minSimilarity,
      outcome: 'no_evidence',
      timingsMilliseconds: { embedding: 0, search: 0, total: Math.round(elapsedMilliseconds) },
    },
  };
}
