import { describe, expect, it } from 'vitest';

import { removeDuplicateSources } from './source-deduplication.js';

const candidate = (chunkId: string, contentHash: string, blockIds: string[]) => ({
  chunkId,
  contentHash,
  blockIds,
});

describe('removeDuplicateSources', () => {
  it('keeps the first of two chunks with the same text', () => {
    const kept = removeDuplicateSources([candidate('a', 'same', ['1']), candidate('b', 'same', ['2'])]);

    expect(kept.map((source) => source.chunkId)).toEqual(['a']);
  });

  it('drops a chunk whose blocks mostly overlap a better-ranked one', () => {
    const kept = removeDuplicateSources([
      candidate('a', 'h1', ['header', 'row1', 'row2']),
      candidate('b', 'h2', ['header', 'row1']),
    ]);

    expect(kept.map((source) => source.chunkId)).toEqual(['a']);
  });

  it('keeps chunks that share only a repeated table header', () => {
    const kept = removeDuplicateSources([
      candidate('a', 'h1', ['header', 'row1', 'row2']),
      candidate('b', 'h2', ['header', 'row3', 'row4']),
    ]);

    expect(kept.map((source) => source.chunkId)).toEqual(['a', 'b']);
  });
});
