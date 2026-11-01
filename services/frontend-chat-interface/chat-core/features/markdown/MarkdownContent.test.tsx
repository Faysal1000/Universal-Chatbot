import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Citation } from '@chat-core/api/chatApiContract';
import { TooltipProvider } from '@chat-core/shared/ui/Tooltip';

import { MarkdownContent } from './MarkdownContent';

function renderMarkdown(content: string, citations: Citation[] = [], onOpenCitation = vi.fn()) {
  const view = render(
    <TooltipProvider>
      <MarkdownContent content={content} citations={citations} onOpenCitation={onOpenCitation} />
    </TooltipProvider>,
  );
  return { ...view, onOpenCitation };
}

const citation: Citation = {
  id: 'cit_1',
  marker: 1,
  kind: 'text',
  documentId: 'doc',
  documentTitle: 'Handbook.pdf',
  page: 12,
  snippet: 'snippet',
  bbox: null,
  hasPreview: true,
};

describe('MarkdownContent safety', () => {
  it.each([
    ['script tag', '<script>window.__pwned = true</script>'],
    ['img onerror', '<img src="x" onerror="window.__pwned = true">'],
    ['iframe', '<iframe src="https://evil.example"></iframe>'],
    ['svg onload', '<svg onload="window.__pwned = true"></svg>'],
    ['inline event handler', '<div onclick="window.__pwned = true">click</div>'],
  ])('never turns raw HTML (%s) into DOM elements', (_name, payload) => {
    const { container } = renderMarkdown(`Before\n\n${payload}\n\nAfter`);
    expect(container.querySelector('script, img, iframe, svg, [onclick], [onerror], [onload]')).toBeNull();
    // The markup is shown as text instead of being silently dropped.
    expect(container.textContent).toContain(payload.slice(0, 8));
    expect((window as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('strips dangerous link protocol %s', (href) => {
    const { container } = renderMarkdown(`[click me](${href})`);
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('click me')).toBeInTheDocument();
  });

  it('drops markdown images from model output', () => {
    const { container } = renderMarkdown('![tracking pixel](https://evil.example/pixel.png)');
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps safe links and opens them in a new tab without referrer', () => {
    renderMarkdown('[docs](https://example.com/docs)');
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('MarkdownContent rendering', () => {
  it('renders GFM tables inside a scroll container', () => {
    const { container } = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(container.querySelector('.table-scroll table')).not.toBeNull();
    expect(screen.getAllByRole('cell')).toHaveLength(2);
  });

  it('renders inline and display math with KaTeX once it has loaded', async () => {
    const { container } = renderMarkdown('Inline $E = mc^2$ and\n\n$$\n\\frac{a}{b}\n$$');
    await waitFor(() => expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2));
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('highlights fenced code once highlight.js has loaded, with a copy button and the language', async () => {
    const { container } = renderMarkdown('```typescript\nconst answer: number = 42;\n```');
    await waitFor(() => expect(container.querySelector('pre code.hljs')).not.toBeNull());
    expect(container.querySelector('[class^="hljs-"]')).not.toBeNull();
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy code/i })).toBeInTheDocument();
  });

  it('turns [n] markers into citation chips that open the source', () => {
    const { onOpenCitation } = renderMarkdown('Employees get 21 days [1].', [citation]);
    const chip = screen.getByRole('button', { name: /open source 1: handbook\.pdf, page 12/i });
    chip.click();
    expect(onOpenCitation).toHaveBeenCalledWith(citation);
  });

  it('leaves [n] inside code untouched and shows unknown markers as plain text', () => {
    const { container } = renderMarkdown('Use `arr[1]` here [7].', [citation]);
    expect(container.querySelector('code')?.textContent).toBe('arr[1]');
    expect(screen.queryByRole('button', { name: /open source/i })).toBeNull();
    expect(container.textContent).toContain('[7]');
  });
});

describe('MarkdownContent with sources hidden by the admin', () => {
  it('drops citation markers instead of rendering chips, but keeps code as written', () => {
    const { container } = render(
      <TooltipProvider>
        <MarkdownContent
          content="Employees get 21 days [1]. Use `arr[1]`."
          citations={[citation]}
          showCitations={false}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: /open source/i })).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('Employees get 21 days . Use arr[1].');
    expect(container.querySelector('code')?.textContent).toBe('arr[1]');
  });
});
