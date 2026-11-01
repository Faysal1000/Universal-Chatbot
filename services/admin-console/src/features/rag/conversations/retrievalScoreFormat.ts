/**
 * Display of retrieval scores. Each score kind has its own scale, so each has its own precision:
 * cosine similarity (−1…1), Reciprocal Rank Fusion sums (about 0.016 per list at k = 60) and
 * small Postgres full-text ranks.
 */
import { MISSING_VALUE_PLACEHOLDER } from '@/shared/lib/format';

type MaybeScore = number | null | undefined;

function isMissing(score: MaybeScore): score is null | undefined {
  return score === null || score === undefined || Number.isNaN(score);
}

/** Dense cosine similarity: 0.71234 → "0.712". */
export function formatSimilarity(similarity: MaybeScore): string {
  return isMissing(similarity) ? MISSING_VALUE_PLACEHOLDER : similarity.toFixed(3);
}

/** Reciprocal Rank Fusion score: 0.0327868 → "0.0328". */
export function formatFusedScore(fusedScore: MaybeScore): string {
  return isMissing(fusedScore) ? MISSING_VALUE_PLACEHOLDER : fusedScore.toFixed(4);
}

/** Full-text keyword rank: 0.0151982 → "0.0152". */
export function formatKeywordScore(keywordScore: MaybeScore): string {
  return isMissing(keywordScore) ? MISSING_VALUE_PLACEHOLDER : keywordScore.toFixed(4);
}

/** 1-based rank: 3 → "#3". */
export function formatRank(rank: MaybeScore): string {
  return isMissing(rank) ? MISSING_VALUE_PLACEHOLDER : `#${rank}`;
}
