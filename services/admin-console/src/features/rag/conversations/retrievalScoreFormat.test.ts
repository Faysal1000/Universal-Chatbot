import { formatKeywordScore, formatFusedScore, formatRank, formatSimilarity } from './retrievalScoreFormat';

describe('retrieval score formatters', () => {
  it('formats each score kind with its own precision', () => {
    expect(formatSimilarity(0.71234)).toBe('0.712');
    expect(formatFusedScore(0.0327868)).toBe('0.0328');
    expect(formatKeywordScore(0.0151982)).toBe('0.0152');
    expect(formatRank(3)).toBe('#3');
  });

  it('shows a dash for missing scores', () => {
    expect(formatSimilarity(null)).toBe('—');
    expect(formatFusedScore(undefined)).toBe('—');
    expect(formatRank(null)).toBe('—');
  });
});
