import { describe, expect, it } from 'vitest';

import { fuseRankedLists } from './reciprocal-rank-fusion.js';

describe('fuseRankedLists', () => {
  it('ranks an item found by both searches above items found by one', () => {
    const fused = fuseRankedLists([{ itemIds: ['a', 'b', 'c'] }, { itemIds: ['d', 'b', 'e'] }]);

    expect(fused[0]?.itemId).toBe('b');
  });

  it('scores each list position as 1 / (k + rank)', () => {
    const [onlyItem] = fuseRankedLists([{ itemIds: ['a'] }], 60);

    expect(onlyItem?.fusedScore).toBeCloseTo(1 / 61);
  });

  it('counts an id only once per list', () => {
    const [item] = fuseRankedLists([{ itemIds: ['a', 'a'] }], 60);

    expect(item?.fusedScore).toBeCloseTo(1 / 61);
  });

  it('returns nothing for empty lists', () => {
    expect(fuseRankedLists([{ itemIds: [] }, { itemIds: [] }])).toEqual([]);
  });

  it('orders ties by id so results are deterministic', () => {
    const fused = fuseRankedLists([{ itemIds: ['b'] }, { itemIds: ['a'] }]);

    expect(fused.map((item) => item.itemId)).toEqual(['a', 'b']);
  });
});
