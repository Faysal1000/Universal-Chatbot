import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { selectShowSources, useChatStore } from '@chat-core/features/chat/chatStore';
import { IconButton } from '@chat-core/shared/ui/IconButton';

import { SourcePreview } from './SourcePreview';
import { useCitationPanelStore } from './citationPanelStore';

/** The chat app's source preview: a side sheet (bottom sheet on mobile) over the page. */
export function SourcePreviewPanel() {
  const { t } = useTranslation();
  const { citation: selectedCitation, siblings, open, close } = useCitationPanelStore();
  // Sources hidden by the admin: the panel never opens, even if a stale selection exists.
  const showSources = useChatStore(selectShowSources);
  const citation = showSources ? selectedCitation : null;

  return (
    <Dialog.Root open={citation !== null} onOpenChange={(isOpen) => !isOpen && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] lg:bg-black/10" />
        <Dialog.Content
          aria-describedby={undefined}
          // Focus the panel, not its first button: a focused icon button shows its tooltip, and the first
          // Escape would then only close the tooltip instead of the panel.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border border-line bg-canvas shadow-elevated outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[440px] sm:rounded-none sm:rounded-l-2xl"
        >
          {citation && (
            <SourcePreview
              citation={citation}
              siblings={siblings}
              onSelect={(selected) => open(selected, siblings)}
              titleAs={Dialog.Title}
              closeButton={
                <Dialog.Close asChild>
                  <IconButton label={t('citations.close')} icon={<X />} />
                </Dialog.Close>
              }
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
