import { Check, Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useCopyToClipboard } from '@chat-core/shared/hooks/useCopyToClipboard';

interface CodeBlockProps {
  language: string | null;
  code: string;
  children: ReactNode;
}

/** Fenced code block with a language label and a copy button. Highlighting is done by rehype-highlight. */
export function CodeBlock({ language, code, children }: CodeBlockProps) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border border-line bg-code">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-1.5 text-xs text-ink-muted">
        <span className="font-mono lowercase">{language ?? 'text'}</span>
        <button
          type="button"
          onClick={() => void copy(code)}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-surface hover:text-ink"
          aria-label={copied ? t('code.copied') : t('code.copy')}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          <span aria-hidden>{copied ? t('code.copied') : t('code.copy')}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[0.84rem] leading-relaxed">{children}</pre>
    </div>
  );
}
