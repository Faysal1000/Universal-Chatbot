import { describe, expect, it } from 'vitest';

import { MESSAGE_FRAMING_TOKENS, TokenEstimator } from './token-estimator.js';

describe('TokenEstimator', () => {
  const exactEstimator = new TokenEstimator(1);

  it('counts nothing for empty text', () => {
    expect(exactEstimator.estimate('')).toBe(0);
  });

  it('counts English text with o200k_base', () => {
    expect(exactEstimator.estimate('The library opens at nine in the morning.')).toBe(9);
  });

  it('counts Bengali text as more tokens than characters per word, never zero', () => {
    const bengaliSentence = 'গ্রন্থাগারটি সকাল নয়টায় খোলে।';

    const bengaliTokens = exactEstimator.estimate(bengaliSentence);

    expect(bengaliTokens).toBeGreaterThan(5);
    expect(bengaliTokens).toBeLessThan(bengaliSentence.length);
  });

  it('applies the safety factor and rounds up', () => {
    const cautiousEstimator = new TokenEstimator(1.2);

    expect(cautiousEstimator.estimate('The library opens at nine in the morning.')).toBe(Math.ceil(9 * 1.2));
  });

  it('adds message framing to message estimates', () => {
    expect(exactEstimator.estimateMessage('hi')).toBe(exactEstimator.estimate('hi') + MESSAGE_FRAMING_TOKENS);
  });

  it('truncates to the token budget and leaves short text untouched', () => {
    const text = 'one two three four five six seven eight nine ten';

    expect(exactEstimator.truncate(text, 100)).toBe(text);
    expect(exactEstimator.estimate(exactEstimator.truncate(text, 3))).toBeLessThanOrEqual(3);
  });

  it('truncates Bengali text without breaking the budget', () => {
    const bengaliParagraph = 'বাংলাদেশের রাজধানী ঢাকা। '.repeat(40);

    const truncated = exactEstimator.truncate(bengaliParagraph, 50);

    expect(exactEstimator.estimate(truncated)).toBeLessThanOrEqual(50);
    expect(truncated.length).toBeGreaterThan(0);
  });

  it('refuses a safety factor below one', () => {
    expect(() => new TokenEstimator(0.5)).toThrow(RangeError);
  });
});
