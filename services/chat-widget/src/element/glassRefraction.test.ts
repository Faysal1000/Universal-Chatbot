import { describe, expect, it } from 'vitest';

import { lensDisplacementMap } from './glassRefraction';

const SIZE = 64;

function pixelAt(map: Uint8ClampedArray, column: number, row: number): { red: number; green: number } {
  const offset = (row * SIZE + column) * 4;
  return { red: map[offset] ?? 0, green: map[offset + 1] ?? 0 };
}

describe('lensDisplacementMap', () => {
  const map = lensDisplacementMap(SIZE);

  it('leaves the centre of the lens flat', () => {
    expect(pixelAt(map, SIZE / 2, SIZE / 2)).toEqual({ red: 128, green: 128 });
  });

  it('pulls the backdrop inwards at the rim', () => {
    expect(pixelAt(map, SIZE - 1, SIZE / 2).red).toBeLessThan(40);
    expect(pixelAt(map, 0, SIZE / 2).red).toBeGreaterThan(216);
    expect(pixelAt(map, SIZE / 2, SIZE - 1).green).toBeLessThan(40);
  });
});
