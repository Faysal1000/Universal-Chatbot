import { ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import type { ThreadState } from '@chat-core/features/chat/chatThreadModel';

/** Loads the previous page of history; shown at the top of a conversation that has older messages. */
export function LoadEarlierMessagesButton({ status }: { status: ThreadState['olderStatus'] }) {
  const { t } = useTranslation();
  const controller = useChatController();
  const isLoading = status === 'loading';

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => void controller.loadEarlierMessages()}
        disabled={isLoading}
        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-60"
      >
        <ChevronUp className="size-4" aria-hidden />
        {isLoading ? t('message.loadingEarlier') : t('message.loadEarlier')}
      </button>
      {status === 'error' && (
        <p role="alert" className="text-xs text-danger">
          {t('message.loadEarlierFailed')}
        </p>
      )}
    </div>
  );
}
