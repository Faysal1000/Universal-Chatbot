import type { Element } from 'hast';
import { toText } from 'hast-util-to-text';
import { createContext, memo, useContext, useDeferredValue, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import type { Citation } from '@chat-core/api/chatApiContract';
import { CitationChip } from '@chat-core/features/citations/CitationChip';
import { cn } from '@chat-core/shared/ui/cn';

import { CodeBlock } from './CodeBlock';
import { useMarkdownEnhancements } from './markdownEnhancements';
import { markdownSanitizeSchema } from './markdownSanitizeSchema';
import { remarkCitationMarkers } from './remarkCitationMarkers';
import { remarkHtmlAsText } from './remarkHtmlAsText';

interface CitationRenderContext {
  citations: readonly Citation[];
  onOpenCitation: ((citation: Citation) => void) | undefined;
  showCitations: boolean;
}

const CitationContext = createContext<CitationRenderContext>({
  citations: [],
  onOpenCitation: undefined,
  showCitations: true,
});

const remarkPlugins = [remarkGfm, remarkMath, remarkHtmlAsText, remarkCitationMarkers];
const sanitizePlugin = [rehypeSanitize, markdownSanitizeSchema] as const;

function languageOf(node: Element | undefined): string | null {
  const code = node?.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'code',
  );
  const classNames = code?.properties.className;
  const list = Array.isArray(classNames) ? classNames : [];
  const languageClass = list.find((name) => typeof name === 'string' && name.startsWith('language-'));
  return typeof languageClass === 'string' ? languageClass.slice('language-'.length) : null;
}

function CitationMarker({ marker, children }: { marker: number; children: ReactNode }) {
  const { citations, onOpenCitation, showCitations } = useContext(CitationContext);
  // Sources hidden by the admin: a marker that slipped through is dropped (markers never come from code).
  if (!showCitations) return null;
  const citation = citations.find((c) => c.marker === marker);
  if (!citation) return <sup className="text-ink-subtle">[{children}]</sup>;
  return <CitationChip citation={citation} onOpen={onOpenCitation} />;
}

const markdownComponents: Components = {
  pre({ node, children }) {
    return (
      <CodeBlock language={languageOf(node)} code={node ? toText(node).replace(/\n$/, '') : ''}>
        {children}
      </CodeBlock>
    );
  },
  table({ children }) {
    return (
      <div className="table-scroll">
        <table>{children}</table>
      </div>
    );
  },
  a({ href, children }) {
    // The sanitiser removes unsafe hrefs (javascript:, data:); render what is left as plain text.
    if (!href) return <span>{children}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  sup({ node, children }) {
    const marker = Number(node?.properties.dataCitation);
    if (Number.isInteger(marker) && marker > 0)
      return <CitationMarker marker={marker}>{children}</CitationMarker>;
    return <sup>{children}</sup>;
  },
};

export interface MarkdownContentProps {
  content: string;
  citations?: readonly Citation[];
  onOpenCitation?: (citation: Citation) => void;
  /** False when the admin hides sources: `[n]` markers then render as nothing. */
  showCitations?: boolean;
  isStreaming?: boolean;
  className?: string;
}

/**
 * Renders untrusted model markdown safely: GFM tables/lists, KaTeX math, highlighted code, citation chips.
 * KaTeX and highlight.js load on demand, the first time an answer contains math or a code fence.
 * While streaming, rendering is deferred (`useDeferredValue`) so bursts of tokens never block typing or scrolling.
 */
export const MarkdownContent = memo(function MarkdownContent({
  content,
  citations = [],
  onOpenCitation,
  showCitations = true,
  isStreaming = false,
  className,
}: MarkdownContentProps) {
  const deferredContent = useDeferredValue(content);
  const enhancements = useMarkdownEnhancements(deferredContent);
  // Order matters: sanitise first, then add trusted markup (KaTeX, highlight.js) that the sanitiser would strip.
  const rehypePlugins = useMemo(() => [sanitizePlugin, ...enhancements], [enhancements]);
  return (
    <CitationContext.Provider value={{ citations, onOpenCitation, showCitations }}>
      <div className={cn('markdown-body', isStreaming && 'streaming-caret', className)}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins as never}
          components={markdownComponents}
        >
          {deferredContent}
        </ReactMarkdown>
      </div>
    </CitationContext.Provider>
  );
});
