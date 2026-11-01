import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import { useChatStore } from '@chat-core/features/chat/chatStore';
import { ThinkingOrb } from '@chat-core/features/thinking/thinking-orb';

/** Greeting and suggested prompts for a fresh conversation. */
export function EmptyConversationState({ botName }: { botName: string }) {
  const { t } = useTranslation();
  const controller = useChatController();
  const config = useChatStore((state) => state.config);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-10 text-center">
      <ThinkingOrb state="breathing" size={64} aria-hidden />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        {config?.botName ?? botName}
      </h1>
      {config?.greeting && <p className="mt-2 max-w-md text-ink-muted">{config.greeting}</p>}
      {config && config.suggestedPrompts.length > 0 && (
        <section className="mt-8 w-full" aria-labelledby="suggestions-heading">
          <h2
            id="suggestions-heading"
            className="mb-3 text-xs font-semibold tracking-wide text-ink-subtle uppercase"
          >
            {t('empty.suggestions')}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {config.suggestedPrompts.map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  onClick={() => controller.sendMessage(prompt)}
                  className="group flex h-full w-full items-start justify-between gap-2 rounded-2xl border border-line bg-surface-raised px-4 py-3 text-left text-sm text-ink transition-colors hover:border-line-strong hover:bg-surface"
                >
                  <span>{prompt}</span>
                  <ArrowUpRight
                    className="mt-0.5 size-4 shrink-0 text-ink-subtle transition-colors group-hover:text-ink"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
