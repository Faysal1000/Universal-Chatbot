import { describe, expect, it } from 'vitest';

import { blockTypeLabel } from './blockTypeLabels';

describe('blockTypeLabel', () => {
  it('turns rag block types into words', () => {
    expect(blockTypeLabel('page_header')).toBe('Page header');
    expect(blockTypeLabel('table')).toBe('Table');
  });
});
