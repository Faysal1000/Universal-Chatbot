import { describe, expect, it } from 'vitest';

import { katexFontFaces } from './katexStyles';

const KATEX_CSS =
  '@font-face{font-display:block;font-family:KaTeX_AMS;font-style:normal;font-weight:400;' +
  'src:url(fonts/KaTeX_AMS-Regular.woff2) format("woff2"),url(fonts/KaTeX_AMS-Regular.woff) format("woff")}' +
  '.katex{font:normal 1.21em KaTeX_Main}' +
  '@font-face{font-family:KaTeX_Unknown;src:url(fonts/KaTeX_Unknown.woff2) format("woff2")}';

describe('katexFontFaces', () => {
  it('points each face at the bundled woff2 file and drops faces without one', () => {
    const css = katexFontFaces(
      KATEX_CSS,
      new Map([['KaTeX_AMS-Regular.woff2', 'https://cdn.example/assets/KaTeX_AMS-Regular-abc.woff2']]),
    );
    expect(css).toBe(
      '@font-face{font-display:block;font-family:KaTeX_AMS;font-style:normal;font-weight:400;' +
        'src:url("https://cdn.example/assets/KaTeX_AMS-Regular-abc.woff2") format("woff2")}\n',
    );
  });
});
