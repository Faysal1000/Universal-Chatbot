import { describe, expect, it } from 'vitest';

import { resolveOrbPreset, scaleCounts, scaleRadii } from './orbPresets';
import type { OrbSize, OrbState } from './orbTypes';

const STATES: OrbState[] = ['breathing', 'shaping', 'searching', 'working', 'composing'];
const SIZES: OrbSize[] = [64, 32, 20];

describe('resolveOrbPreset', () => {
  it('caches each (state, size) pair', () => {
    expect(resolveOrbPreset('searching', 64)).toBe(resolveOrbPreset('searching', 64));
  });

  it('interpolates the 32 px preset between the tuned 64 px and 20 px designs', () => {
    for (const state of STATES) {
      const large = resolveOrbPreset(state, 64).speed;
      const small = resolveOrbPreset(state, 20).speed;
      const middle = resolveOrbPreset(state, 32).speed;
      expect(middle).toBeGreaterThanOrEqual(Math.min(large, small));
      expect(middle).toBeLessThanOrEqual(Math.max(large, small));
    }
  });

  it('keeps layers a state opted out of (breathing has no ghost sphere)', () => {
    for (const size of SIZES) expect(resolveOrbPreset('breathing', size).options.ghostN).toBe(0);
  });
});

describe('option scaling', () => {
  it('scales paired lattice counts by √scale each, so the total scales by `scale`', () => {
    expect(scaleCounts({ latRings: 16, lonDensity: 40 }, 0.25)).toEqual({ latRings: 8, lonDensity: 20 });
  });

  it('scales every radius key and records the multiplier', () => {
    expect(scaleRadii({ rBase: 1, partR: 2, latRings: 10 }, 2)).toEqual({
      rBase: 2,
      partR: 4,
      latRings: 10,
      rSizeMul: 2,
    });
  });
});

describe('orb frames', () => {
  it.each(STATES.flatMap((state) => SIZES.map((size) => [state, size] as const)))(
    '%s at %i px: deterministic, z-sorted, inside the canvas',
    (state, size) => {
      const { frame, options } = resolveOrbPreset(state, size);
      const first = frame(size, 3.7, options);
      expect(frame(size, 3.7, options)).toEqual(first);
      expect(first.dots.length).toBeGreaterThan(5);
      for (let i = 1; i < first.dots.length; i++)
        expect(first.dots[i]!.z).toBeGreaterThanOrEqual(first.dots[i - 1]!.z);
      for (const dot of first.dots) {
        expect(dot.x).toBeGreaterThanOrEqual(-1);
        expect(dot.x).toBeLessThanOrEqual(size + 1);
        expect(dot.y).toBeGreaterThanOrEqual(-1);
        expect(dot.y).toBeLessThanOrEqual(size + 1);
        expect(dot.r).toBeGreaterThan(0);
      }
    },
  );

  it('animates over time', () => {
    const { frame, options } = resolveOrbPreset('working', 64);
    expect(frame(64, 0, options)).not.toEqual(frame(64, 1, options));
  });
});
