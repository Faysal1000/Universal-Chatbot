import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@chat-core/shared/ui/cn';

interface ReasoningDisclosureProps {
  reasoning: string;
  isThinking: boolean;
  startedAt: number | null;
  endedAt: number | null;
}

/**
 * Collapsible "Thinking…" section for the model's reasoning stream. Opens automatically while the model
 * thinks and collapses once the answer starts, unless the user has toggled it themselves.
 */
export function ReasoningDisclosure({ reasoning, isThinking, startedAt, endedAt }: ReasoningDisclosureProps) {
  const { t } = useTranslation();
  const contentId = useId();
  // null = follow the stream (open while thinking); a boolean = the user's explicit choice.
  const [userChoice, setUserChoice] = useState<boolean | null>(null);
  const isOpen = userChoice ?? isThinking;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest reasoning visible while it streams.
  useEffect(() => {
    if (isThinking && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [reasoning, isThinking]);

  const seconds =
    startedAt !== null && endedAt !== null ? Math.max(1, Math.round((endedAt - startedAt) / 1000)) : null;
  const title = isThinking
    ? t('reasoning.thinking')
    : seconds !== null
      ? t('reasoning.thoughtFor', { seconds })
      : t('reasoning.thought');

  return (
    <div className="mb-3">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setUserChoice(!isOpen)}
        className="group inline-flex items-center gap-2 rounded-lg py-1 pr-2 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <span className={cn(isThinking && 'animate-pulse')}>{title}</span>
        <ChevronDown className={cn('size-4 transition-transform', isOpen && 'rotate-180')} aria-hidden />
      </button>
      <div
        id={contentId}
        data-testid="reasoning-content"
        hidden={!isOpen}
        ref={scrollRef}
        className="mt-1 max-h-60 overflow-y-auto border-l-2 border-line py-1 pl-4 text-sm leading-relaxed whitespace-pre-wrap text-ink-muted"
      >
        {reasoning}
      </div>
    </div>
  );
}
