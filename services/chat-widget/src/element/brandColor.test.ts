import { describe, expect, it } from 'vitest';

import { contrastRatio, inkForBrandColor, parseComputedRgb } from './brandColor';

describe('brand colour', () => {
  it('parses computed rgb and rgba strings', () => {
    expect(parseComputedRgb('rgb(15, 118, 110)')).toEqual({ red: 15, green: 118, blue: 110 });
    expect(parseComputedRgb('rgba(255 200 0 / 0.5)')).toEqual({ red: 255, green: 200, blue: 0 });
    expect(parseComputedRgb('oklch(0.5 0.1 200)')).toBeNull();
  });

  it('uses white labels on dark brands and near-black ones on light brands', () => {
    expect(inkForBrandColor({ red: 109, green: 93, blue: 252 })).toBe('#ffffff');
    expect(inkForBrandColor({ red: 15, green: 118, blue: 110 })).toBe('#ffffff');
    expect(inkForBrandColor({ red: 250, green: 204, blue: 21 })).toBe('#111111');
  });

  it('computes WCAG contrast', () => {
    const white = { red: 255, green: 255, blue: 255 };
    const black = { red: 0, green: 0, blue: 0 };
    expect(contrastRatio(white, black)).toBeCloseTo(21, 0);
    expect(contrastRatio(white, white)).toBe(1);
  });
});
