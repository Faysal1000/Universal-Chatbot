import { describe, expect, it } from 'vitest';

import { toSearchDocument, toSearchQuery } from './search-terms.js';

describe('toSearchDocument', () => {
  it('lists each term once with all its positions', () => {
    expect(toSearchDocument('Refund policy: refund within 30 days')).toBe(
      "'refund':1,3 'policy':2 'within':4 '30':5 'days':6",
    );
  });

  it('escapes quotes and backslashes inside terms', () => {
    expect(toSearchDocument("o'brien")).toBe("'o''brien':1");
  });
});

describe('toSearchQuery', () => {
  it('matches any distinct term', () => {
    expect(toSearchQuery('refund the refund')).toBe("'refund'");
    expect(toSearchQuery('refund policy')).toBe("'refund' | 'policy'");
  });

  it('is undefined when only stop words remain', () => {
    expect(toSearchQuery('what is the')).toBeUndefined();
  });
});
