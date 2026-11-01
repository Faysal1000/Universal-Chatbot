import {
  Check,
  Copy,
  MessageSquareOff,
  RefreshCw,
  SearchX,
  Square,
  ThumbsDown,
  ThumbsUp,
  WifiOff,
} from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { Citation } from '@chat-core/api/chatApiContract';
import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import { selectShowSources, useChatStore } from '@chat-core/features/chat/chatStore';
import { isEmptyAnswer, isReplyInFlight, type TurnView } from '@chat-core/features/chat/chatThreadModel';
import { CitationSourceList } from '@chat-core/features/citations/CitationSourceList';
import { useCitationPanelStore } from '@chat-core/features/citations/citationPanelStore';
import { MarkdownContent } from '@chat-core/features/markdown/MarkdownContent';
import { AssistantThinkingOrb } from '@chat-core/features/thinking/AssistantThinkingOrb';
import { ReasoningDisclosure } from '@chat-core/features/thinking/ReasoningDisclosure';
import { useCopyToClipboard } from '@chat-core/shared/hooks/useCopyToClipboard';
import { IconButton } from '@chat-core/shared/ui/IconButton';
import { cn } from '@chat-core/shared/ui/cn';
import { showToast } from '@chat-core/shared/ui/toastStore';

import { ReplyErrorNotice } from './ReplyErrorNotice';

interface AssistantReplyProps {
  turn: TurnView;
  isLatest: boolean;
}

const NO_CITATIONS: readonly Citation[] = [];

export const AssistantReply = memo(function AssistantReply({ turn, isLatest }: AssistantReplyProps) {
  const { t } = useTranslation();
  const controller = useChatController();
  const openCitation = useCitationPanelStore((state) => state.open);
  const feedbackEnabled = useChatStore((state) => state.config?.features.feedback ?? false);
  const { copied, copy } = useCopyToClipboard();
  const { reply } = turn;
  const showSources = useChatStore(selectShowSources);
  // Defensive: if citation data arrives although the admin hid sources, it is never shown.
  const citations = showSources ? reply.citations : NO_CITATIONS;

  const inFlight = isReplyInFlight(reply);
  const showOrb = inFlight && reply.content === '' && reply.phase !== 'thinking';
  const stageKey = reply.phase === 'thinking' ? 'thinking' : (reply.stage ?? 'waiting');
  const onOpenCitation = useCallback(
    (citation: Citation) => openCitation(citation, citations),
    [openCitation, citations],
  );

  const sendFeedback = (rating: 'up' | 'down') => {
    controller.sendFeedback(turn.turnId, rating).catch(() => showToast(t('toast.feedbackFailed'), 'error'));
  };

  return (
    <article
      className="group flex gap-3 sm:gap-4"
      aria-busy={inFlight}
      data-testid="assistant-reply"
      data-phase={reply.phase}
    >
      <div className="flex size-8 shrink-0 items-center justify-center" aria-hidden>
        <AssistantThinkingOrb
          phase={inFlight ? reply.phase : 'complete'}
          stage={inFlight ? reply.stage : null}
          size={32}
          label=""
          paused={!inFlight}
        />
      </div>

      <div className="min-w-0 flex-1 pt-1">
        {showOrb && (
          <p className="flex h-6 items-center text-sm text-ink-muted" data-testid="reply-stage">
            <span className="animate-pulse">{t(`stage.${stageKey}`)}</span>
          </p>
        )}

        {reply.reasoning && (
          <ReasoningDisclosure
            reasoning={reply.reasoning}
            isThinking={reply.phase === 'thinking'}
            startedAt={reply.reasoningStartedAt}
            endedAt={reply.reasoningEndedAt}
          />
        )}

        {reply.content && (
          <MarkdownContent
            content={reply.content}
            citations={citations}
            onOpenCitation={onOpenCitation}
            showCitations={showSources}
            isStreaming={reply.phase === 'answering'}
          />
        )}

        {reply.isReconnecting && (
          <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-sm text-warning">
            <WifiOff className="size-4" aria-hidden />
            {t('message.reconnecting')}
          </p>
        )}

        {!inFlight && <CitationSourceList citations={citations} onOpen={onOpenCitation} />}

        {reply.finishReason === 'no_evidence' && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs text-ink-muted">
            <SearchX className="size-3.5" aria-hidden />
            {t('message.noEvidence')}
          </p>
        )}
        {isEmptyAnswer(reply) && (
          <p
            className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink-muted"
            data-testid="empty-answer"
          >
            <MessageSquareOff className="size-4" aria-hidden />
            {t('message.emptyAnswer')}
          </p>
        )}
        {reply.phase === 'stopped' && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-subtle">
            <Square className="size-3 fill-current" aria-hidden />
            {t('message.stopped')}
          </p>
        )}

        {reply.phase === 'error' && reply.error && (
          <ReplyErrorNotice
            error={reply.error}
            {...(isLatest ? { onRetry: () => controller.regenerateTurn(turn.turnId) } : {})}
          />
        )}

        {!inFlight && (reply.content || isEmptyAnswer(reply)) && (
          <div
            className={cn(
              'mt-2 flex items-center gap-0.5 transition-opacity focus-within:opacity-100',
              !isLatest && 'sm:opacity-0 sm:group-hover:opacity-100',
            )}
          >
            {reply.content && (
              <IconButton
                size="sm"
                label={copied ? t('message.copied') : t('message.copy')}
                icon={copied ? <Check /> : <Copy />}
                onClick={() => void copy(reply.content)}
              />
            )}
            {isLatest && (
              <IconButton
                size="sm"
                label={t('message.regenerate')}
                icon={<RefreshCw />}
                onClick={() => controller.regenerateTurn(turn.turnId)}
              />
            )}
            {feedbackEnabled && reply.serverId && (
              <>
                <IconButton
                  size="sm"
                  label={t('message.goodResponse')}
                  icon={<ThumbsUp className={cn(reply.feedback === 'up' && 'fill-current')} />}
                  aria-pressed={reply.feedback === 'up'}
                  onClick={() => sendFeedback('up')}
                />
                <IconButton
                  size="sm"
                  label={t('message.badResponse')}
                  icon={<ThumbsDown className={cn(reply.feedback === 'down' && 'fill-current')} />}
                  aria-pressed={reply.feedback === 'down'}
                  onClick={() => sendFeedback('down')}
                />
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
