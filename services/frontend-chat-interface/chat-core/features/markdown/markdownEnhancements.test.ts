import { describe, expect, it } from 'vitest';

import { enhancementsNeededBy } from './markdownEnhancements';

describe('enhancementsNeededBy', () => {
  it('needs nothing for plain prose with citations', () => {
    expect(enhancementsNeededBy('Employees get 21 days of leave [1].')).toEqual([]);
  });

  it('needs KaTeX for dollar, \\( and \\[ math', () => {
    expect(enhancementsNeededBy('Energy is $E = mc^2$.')).toEqual(['math']);
    expect(enhancementsNeededBy('Inline \\(x\\) here')).toEqual(['math']);
    expect(enhancementsNeededBy('\\[ a^2 \\]')).toEqual(['math']);
  });

  it('needs highlight.js only for fenced code', () => {
    expect(enhancementsNeededBy('Use `npm ci` to install.')).toEqual([]);
    expect(enhancementsNeededBy('Run:\n\n```bash\nnpm ci\n```')).toEqual(['highlight']);
    expect(enhancementsNeededBy('  ~~~\ncode\n  ~~~')).toEqual(['highlight']);
  });

  it('can need both', () => {
    expect(enhancementsNeededBy('Cost $5\n```js\nx\n```')).toEqual(['math', 'highlight']);
  });
});
