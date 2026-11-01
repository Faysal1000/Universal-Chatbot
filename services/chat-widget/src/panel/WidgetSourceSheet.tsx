import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { selectShowSources, useChatStore } from '@chat-core/features/chat/chatStore';
import { SourcePreview } from '@chat-core/features/citations/SourcePreview';
import { useCitationPanelStore } from '@chat-core/features/citations/citationPanelStore';
import { IconButton } from '@chat-core/shared/ui/IconButton';

/**
 * The source preview as a sheet over the chat, inside the panel. Escape and the backdrop close it, and focus
 * returns to the citation that opened it.
 */
export function WidgetSourceSheet() {
  const { t } = useTranslation();
  const { citation: selectedCitation, siblings, open, close } = useCitationPanelStore();
  // Sources hidden by the admin: the sheet never opens, even if a stale selection exists.
  const showSources = useChatStore(selectShowSources);
  const citation = showSources ? selectedCitation : null;
  const sheetRef = useRef<HTMLDivElement>(null);
  const isOpen = citation !== null;

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!isOpen || !sheet) return;
    const opener = (sheet.getRootNode() as ShadowRoot | Document).activeElement;
    // Escape closes the sheet only, not the whole panel.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    sheet.addEventListener('keydown', onKeyDown);
    sheet.focus();
    return () => {
      sheet.removeEventListener('keydown', onKeyDown);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [isOpen, close]);

  if (!citation) return null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/30" aria-hidden onClick={close} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={citation.documentTitle}
        tabIndex={-1}
        data-testid="source-sheet"
        className="relative flex max-h-[88%] flex-col rounded-t-2xl border-t border-line bg-canvas shadow-elevated outline-none"
      >
        <SourcePreview
          citation={citation}
          siblings={siblings}
          onSelect={(selected) => open(selected, siblings)}
          closeButton={<IconButton label={t('widget.closeSource')} icon={<X />} onClick={close} />}
        />
      </div>
    </div>
  );
}
