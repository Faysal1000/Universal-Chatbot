/** A retrieved chunk as far as deduplication is concerned. */
export interface DeduplicationCandidate {
  readonly chunkId: string;
  readonly contentHash: string;
  readonly blockIds: readonly string[];
}

/**
 * Keeps the best-ranked of near-identical sources: the same normalised text (a document
 * uploaded twice under different bytes) or chunks built from overlapping blocks (a table
 * split by rows repeats its header block). Input order is the ranking.
 */
export function removeDuplicateSources<Candidate extends DeduplicationCandidate>(
  rankedCandidates: readonly Candidate[],
): Candidate[] {
  const seenContentHashes = new Set<string>();
  const kept: Candidate[] = [];
  for (const candidate of rankedCandidates) {
    if (seenContentHashes.has(candidate.contentHash)) continue;
    if (kept.some((keptCandidate) => sharesMostBlocks(keptCandidate, candidate))) continue;
    seenContentHashes.add(candidate.contentHash);
    kept.push(candidate);
  }
  return kept;
}

/** True when more than half of the smaller chunk's blocks also belong to the other one. */
function sharesMostBlocks(first: DeduplicationCandidate, second: DeduplicationCandidate): boolean {
  const smallerBlockCount = Math.min(first.blockIds.length, second.blockIds.length);
  if (smallerBlockCount === 0) return false;
  const firstBlockIds = new Set(first.blockIds);
  const sharedBlockCount = second.blockIds.filter((blockId) => firstBlockIds.has(blockId)).length;
  return sharedBlockCount * 2 > smallerBlockCount;
}
