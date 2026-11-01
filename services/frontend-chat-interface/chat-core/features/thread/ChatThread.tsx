import { ArrowDown } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { selectActiveBatch, selectActiveThread, useChatStore } from '@chat-core/features/chat/chatStore';
import { isReplyInFlight, type PendingUserMessage } from '@chat-core/features/chat/chatThreadModel';

import { AssistantReply } from './AssistantReply';
import { EmptyConversationState } from './EmptyConversationState';
import { LoadEarlierMessagesButton } from './LoadEarlierMessagesButton';
import { PendingUserMessageBubble, SentUserMessage } from './UserMessageBubble';
import { useStickToBottom } from './useStickToBottom';

const NO_PENDING_MESSAGES: readonly PendingUserMessage[] = [];
/** Screen readers hear the start of a finished answer, not the whole of a long one. */
const ANNOUNCEMENT_MAX_CHARS = 300;

/** Scrollable conversation: sent turns, then messages still waiting in the batching window. */
export function ChatThread({ botName }: { botName: string }) {
  const { t } = useTranslation();
  const thread = useChatStore(selectActiveThread);
  const pending = useChatStore((state) => selectActiveBatch(state)?.pending ?? NO_PENDING_MESSAGES);
  const activeKey = useChatStore((state) => state.activeConversationKey);
  const lastTurn = thread.turns.at(-1);
  const contentKey = `${thread.turns.length}:${lastTurn?.reply.content.length ?? 0}:${lastTurn?.reply.reasoning.length ?? 0}:${pending.length}`;
  const { scrollRef, isAtBottom, scrollToBottom } = useStickToBottom<HTMLDivElement>(contentKey);

  useEffect(() => scrollToBottom('auto'), [activeKey, scrollToBottom]);
  // Sending always brings the newest message into view.
  useEffect(() => {
    if (pending.length > 0) scrollToBottom();
  }, [pending.length, scrollToBottom]);

  const isEmpty = thread.turns.length === 0 && pending.length === 0;
  const announcement =
    lastTurn?.reply.phase === 'complete' ? lastTurn.reply.content.slice(0, ANNOUNCEMENT_MAX_CHARS) : '';

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain" data-testid="chat-scroll">
        <div className="flex min-h-full flex-col">
          {isEmpty && thread.loadStatus !== 'loading' ? (
            <EmptyConversationState botName={botName} />
          ) : (
            <ol
              className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-6 pb-8"
              aria-label={t('message.threadLabel')}
            >
              {thread.olderCursor && (
                <li className="flex justify-center">
                  <LoadEarlierMessagesButton status={thread.olderStatus} />
                </li>
              )}
              {thread.loadStatus === 'loading' && thread.turns.length === 0 && (
                <li className="space-y-3" aria-hidden>
                  <div className="ml-auto h-10 w-2/5 animate-pulse rounded-3xl bg-surface" />
                  <div className="h-24 w-4/5 animate-pulse rounded-2xl bg-surface" />
                </li>
              )}
              {thread.turns.map((turn) => (
                <li key={turn.turnId} className="flex flex-col gap-3">
                  {turn.userMessages.map((message) => (
                    <SentUserMessage
                      key={message.clientMessageId}
                      turnId={turn.turnId}
                      message={message}
                      canEdit={turn === lastTurn && !isReplyInFlight(turn.reply)}
                    />
                  ))}
                  <AssistantReply turn={turn} isLatest={turn === lastTurn} />
                </li>
              ))}
              {pending.length > 0 && (
                <li className="flex flex-col gap-3" aria-label={t('batch.queued')}>
                  {pending.map((message) => (
                    <PendingUserMessageBubble key={message.clientMessageId} message={message} />
                  ))}
                </li>
              )}
            </ol>
          )}
        </div>
      </div>

      {!isAtBottom && !isEmpty && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          aria-label={t('message.jumpToLatest')}
          className="absolute bottom-3 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-canvas text-ink shadow-elevated transition-colors hover:bg-surface"
        >
          <ArrowDown className="size-4" aria-hidden />
        </button>
      )}
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
