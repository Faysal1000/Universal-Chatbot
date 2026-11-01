import { useTranslation } from 'react-i18next';

import type { Citation } from '@chat-core/api/chatApiContract';

import { CitationKindIcon } from './CitationKindIcon';

interface CitationSourceListProps {
  citations: readonly Citation[];
  onOpen: (citation: Citation) => void;
}

/** Footnote-style list of sources under an answer. */
export function CitationSourceList({ citations, onOpen }: CitationSourceListProps) {
  const { t } = useTranslation();
  if (citations.length === 0) return null;
  return (
    <section aria-label={t('citations.sources')} className="mt-4">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
        {t('citations.sources')}
      </h3>
      <ol className="flex flex-wrap gap-2">
        {citations.map((citation) => (
          <li key={citation.id}>
            <button
              type="button"
              onClick={() => onOpen(citation)}
              aria-label={t('citations.open', {
                marker: citation.marker,
                title: citation.documentTitle,
                page: citation.page,
              })}
              className="group flex max-w-72 items-center gap-2 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-left text-sm transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-accent-soft text-[0.7rem] font-semibold text-accent group-hover:bg-accent group-hover:text-accent-ink">
                {citation.marker}
              </span>
              <span className="text-ink-subtle">
                <CitationKindIcon kind={citation.kind} />
              </span>
              <span className="truncate text-ink">{citation.documentTitle}</span>
              <span className="shrink-0 text-xs text-ink-muted">
                {t('citations.page', { page: citation.page })}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
