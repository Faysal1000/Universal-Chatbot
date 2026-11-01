import { useEffect, useSyncExternalStore } from 'react';
import type { Options } from 'react-markdown';

type RehypePlugin = NonNullable<Options['rehypePlugins']>[number];

/** Heavy renderers loaded only when an answer needs them: KaTeX for math, highlight.js for fenced code. */
export type MarkdownEnhancement = 'math' | 'highlight';

const ENHANCEMENT_ORDER: readonly MarkdownEnhancement[] = ['math', 'highlight'];

const LOADERS: Record<MarkdownEnhancement, () => Promise<RehypePlugin>> = {
  math: async () => {
    const { default: rehypeKatex } = await import('rehype-katex');
    return [rehypeKatex, { throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' }];
  },
  highlight: async () => {
    const { default: rehypeHighlight } = await import('rehype-highlight');
    return [rehypeHighlight, { detect: false }];
  },
};

const loadedPlugins = new Map<MarkdownEnhancement, RehypePlugin>();
const pendingLoads = new Map<MarkdownEnhancement, Promise<void>>();
const listeners = new Set<() => void>();
let loadedVersion = 0;

/** Which enhancements a piece of markdown could use: `$`, `\(` or `\[` for math, a fence for code. */
export function enhancementsNeededBy(markdown: string): MarkdownEnhancement[] {
  const needed: MarkdownEnhancement[] = [];
  if (/\$|\\\(|\\\[/.test(markdown)) needed.push('math');
  if (/^\s*(```|~~~)/m.test(markdown)) needed.push('highlight');
  return needed;
}

function loadMarkdownEnhancement(enhancement: MarkdownEnhancement): Promise<void> {
  if (loadedPlugins.has(enhancement)) return Promise.resolve();
  let load = pendingLoads.get(enhancement);
  if (!load) {
    load = LOADERS[enhancement]()
      .then((plugin) => {
        loadedPlugins.set(enhancement, plugin);
        loadedVersion += 1;
        for (const listener of listeners) listener();
      })
      .finally(() => pendingLoads.delete(enhancement));
    pendingLoads.set(enhancement, load);
  }
  return load;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The rehype plugins this markdown can use right now. Missing ones start loading, and the component re-renders
 * once they arrive; until then math shows as its source and code without colours.
 */
export function useMarkdownEnhancements(markdown: string): RehypePlugin[] {
  const needed = enhancementsNeededBy(markdown);
  const neededKey = needed.join(',');
  useSyncExternalStore(subscribe, () => loadedVersion);

  useEffect(() => {
    for (const enhancement of neededKey.split(',')) {
      if (enhancement === 'math' || enhancement === 'highlight')
        void loadMarkdownEnhancement(enhancement).catch(() => undefined);
    }
  }, [neededKey]);

  return ENHANCEMENT_ORDER.filter((enhancement) => needed.includes(enhancement)).flatMap((enhancement) => {
    const plugin = loadedPlugins.get(enhancement);
    return plugin === undefined ? [] : [plugin];
  });
}
