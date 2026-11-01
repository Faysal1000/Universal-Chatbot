import { describe, expect, it } from 'vitest';

import { ribbonOrbFrame } from './ribbonOrbGeometry';

describe('ribbonOrbFrame', () => {
  it('keeps every dot inside the orb and orders them far to near', () => {
    for (const seconds of [0, 1.7, 42]) {
      const dots = ribbonOrbFrame(seconds);
      expect(dots.length).toBeGreaterThan(0);
      for (const dot of dots) {
        expect(Math.hypot(dot.x, dot.y)).toBeLessThanOrEqual(1.05);
        expect(dot.colorPosition).toBeGreaterThanOrEqual(0);
        expect(dot.colorPosition).toBeLessThan(1);
      }
      const depths = dots.map((dot) => dot.depth);
      expect(depths).toEqual([...depths].sort((first, second) => first - second));
    }
  });

  it('moves over time', () => {
    expect(ribbonOrbFrame(0)).not.toEqual(ribbonOrbFrame(0.5));
  });
});
