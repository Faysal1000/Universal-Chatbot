import katexCss from 'katex/dist/katex.min.css?raw';

/** KaTeX's woff2 files, emitted next to the bundle; their URLs resolve against the script, not the page. */
const KATEX_FONT_URLS = import.meta.glob<string>('/node_modules/katex/dist/fonts/*.woff2', {
  query: '?url',
  import: 'default',
  eager: true,
});

const FONT_FACE_PATTERN = /@font-face\{[^}]*\}/g;
const FONT_STYLE_ELEMENT_ID = 'universal-chat-bot-katex-fonts';

/** KaTeX's layout rules, for the shadow root (its `@font-face` rules would be ignored there). */
export const katexRules: string = katexCss.replace(FONT_FACE_PATTERN, '');

/**
 * Browsers ignore `@font-face` inside shadow roots, so KaTeX's fonts are declared once on the page. Only the
 * `KaTeX_*` families are added; the files download only when an answer actually contains math.
 */
export function installKatexFontsOnPage(): void {
  if (document.getElementById(FONT_STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = FONT_STYLE_ELEMENT_ID;
  style.textContent = katexFontFaces(katexCss, fontUrlByFileName());
  document.head.append(style);
}

/** Rewrites KaTeX's `@font-face` rules to woff2-only sources at the given URLs. */
export function katexFontFaces(css: string, urlByFileName: ReadonlyMap<string, string>): string {
  return (css.match(FONT_FACE_PATTERN) ?? [])
    .map((rule) => {
      const fileName = /url\(fonts\/([^)]+\.woff2)\)/.exec(rule)?.[1];
      const url = fileName === undefined ? undefined : urlByFileName.get(fileName);
      if (url === undefined) return '';
      return rule.replace(/src:[^;}]+/, `src:url(${JSON.stringify(url)}) format("woff2")`);
    })
    .join('\n');
}

function fontUrlByFileName(): Map<string, string> {
  return new Map(
    Object.entries(KATEX_FONT_URLS).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
  );
}
