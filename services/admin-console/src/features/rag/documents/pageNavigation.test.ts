import { describe, expect, it } from 'vitest';

import { pageIndexAfterKey } from './pageNavigation';

describe('pageIndexAfterKey', () => {
  it('steps with the arrow keys and stops at the ends', () => {
    expect(pageIndexAfterKey('ArrowDown', 0, 3)).toBe(1);
    expect(pageIndexAfterKey('ArrowRight', 2, 3)).toBe(2);
    expect(pageIndexAfterKey('ArrowUp', 0, 3)).toBe(0);
    expect(pageIndexAfterKey('ArrowLeft', 2, 3)).toBe(1);
  });

  it('jumps with Home and End', () => {
    expect(pageIndexAfterKey('Home', 2, 3)).toBe(0);
    expect(pageIndexAfterKey('End', 0, 3)).toBe(2);
  });

  it('ignores other keys and empty lists', () => {
    expect(pageIndexAfterKey('Enter', 1, 3)).toBeNull();
    expect(pageIndexAfterKey('ArrowDown', 0, 0)).toBeNull();
  });
});
