import { AlertTriangle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { API_ERROR_CODES } from '@chat-core/api/chatApiContract';
import type { ReplyError } from '@chat-core/features/chat/chatThreadModel';
import { useNow } from '@chat-core/shared/hooks/useNow';

interface ReplyErrorNoticeProps {
  error: ReplyError;
  /** Omitted when retrying is impossible (only the latest reply can be regenerated). */
  onRetry?: () => void;
}

/**
 * Error state of a reply: a localised message, the server's request id to quote to support, and a retry button
 * that waits out `Retry-After` (429/503) with a countdown.
 */
export function ReplyErrorNotice({ error, onRetry }: ReplyErrorNoticeProps) {
  const { t } = useTranslation();
  const now = useNow(error.retryNotBefore !== null, 500);
  const waitSeconds =
    error.retryNotBefore === null ? 0 : Math.max(0, Math.ceil((error.retryNotBefore - now) / 1000));

  return (
    <div
      role="alert"
      className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm"
    >
      <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden />
      <span className="flex-1 text-ink">
        <span className="font-medium">
          {error.code === API_ERROR_CODES.turnNotReplaceable
            ? t('errors.turnNotReplaceable')
            : t(`errors.${error.kind}`)}
        </span>
        {/* Server detail adds information only for generic failures; known kinds have a localised message. */}
        {(error.kind === 'server' || error.kind === 'validation') && error.message && (
          <span className="text-ink-muted"> {error.message}</span>
        )}
        {error.requestId && (
          <span className="block font-mono text-xs text-ink-subtle select-all">
            {t('errors.reference', { id: error.requestId })}
          </span>
        )}
      </span>
      {error.retryable && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={waitSeconds > 0}
          className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-canvas px-3 py-1 font-medium text-ink transition-colors hover:bg-surface disabled:opacity-60"
        >
          <RotateCw className="size-3.5" aria-hidden />
          <span className="tabular-nums">
            {waitSeconds > 0 ? t('errors.retryIn', { seconds: waitSeconds }) : t('errors.retry')}
          </span>
        </button>
      )}
    </div>
  );
}
