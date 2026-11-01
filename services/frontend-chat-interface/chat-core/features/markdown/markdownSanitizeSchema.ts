import { defaultSchema, type Schema } from 'hast-util-sanitize';

/**
 * GitHub-style allow-list plus exactly what this pipeline needs:
 * - `language-*` / `math-*` classes so highlighting and KaTeX can run after sanitising,
 * - `data-citation` on `<sup>` for citation chips.
 * KaTeX and highlight.js run AFTER this step, so their generated markup is trusted and never filtered here.
 * Images and iframes from model output are dropped entirely; protocols are limited to http(s)/mailto.
 */
export const markdownSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (tag) => !['img', 'picture', 'source', 'iframe'].includes(tag),
  ),
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-[\w-]+$/, 'math-inline', 'math-display']],
    span: [['className', 'math-inline', 'math-display']],
    div: [['className', 'math-display']],
    sup: [...(defaultSchema.attributes?.sup ?? []), 'dataCitation'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
};
