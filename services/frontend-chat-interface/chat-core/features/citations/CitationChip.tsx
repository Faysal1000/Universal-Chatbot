import { useTranslation } from 'react-i18next';

import type { Citation } from '@chat-core/api/chatApiContract';
import { Tooltip } from '@chat-core/shared/ui/Tooltip';

import { CitationKindIcon } from './CitationKindIcon';

interface CitationChipProps {
  citation: Citation;
  onOpen: ((citation: Citation) => void) | undefined;
}

/** Inline `[n]` marker rendered as a compact, keyboard-accessible chip that opens the source preview. */
export function CitationChip({ citation, onOpen }: CitationChipProps) {
  const { t } = useTranslation();
  const label = t('citations.open', {
    marker: citation.marker,
    title: citation.documentTitle,
    page: citation.page,
  });
  return (
    <Tooltip
      label={
        <span className="block max-w-64">
          <span className="block font-semibold">{citation.documentTitle}</span>
          <span className="inline-flex items-center gap-1 opacity-80">
            <CitationKindIcon kind={citation.kind} />
            {t('citations.pageLong', { page: citation.page })}
          </span>
        </span>
      }
    >
      <button
        type="button"
        onClick={() => onOpen?.(citation)}
        aria-label={label}
        className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded-md bg-accent-soft px-1 align-middle font-sans text-[0.68rem] leading-none font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-ink"
      >
        {citation.marker}
      </button>
    </Tooltip>
  );
}
