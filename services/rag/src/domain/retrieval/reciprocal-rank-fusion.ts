/**
 * Reciprocal Rank Fusion (Cormack et al., 2009): every ranked list adds 1 / (k + rank)
 * to an item's score. It needs no score calibration between dense cosine and full-text rank,
 * which live on unrelated scales.
 */
const DEFAULT_RRF_RANK_CONSTANT = 60;

export interface RankedList {
  /** Item ids, best first. */
  readonly itemIds: readonly string[];
}

export interface FusedItem {
  readonly itemId: string;
  readonly fusedScore: number;
}

export function fuseRankedLists(
  rankedLists: readonly RankedList[],
  rankConstant = DEFAULT_RRF_RANK_CONSTANT,
): FusedItem[] {
  const fusedScores = new Map<string, number>();
  for (const rankedList of rankedLists) {
    const seenInList = new Set<string>();
    rankedList.itemIds.forEach((itemId, index) => {
      if (seenInList.has(itemId)) return;
      seenInList.add(itemId);
      fusedScores.set(itemId, (fusedScores.get(itemId) ?? 0) + 1 / (rankConstant + index + 1));
    });
  }
  return [...fusedScores.entries()]
    .map(([itemId, fusedScore]) => ({ itemId, fusedScore }))
    .sort(
      (first, second) => second.fusedScore - first.fusedScore || first.itemId.localeCompare(second.itemId),
    );
}
