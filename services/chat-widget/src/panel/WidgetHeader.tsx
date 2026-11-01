import { SquarePen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ThinkingOrb } from '@chat-core/features/thinking/thinking-orb';
import { IconButton } from '@chat-core/shared/ui/IconButton';

import type { WidgetLanguage } from '../element/widgetSettings';

interface WidgetHeaderProps {
  botName: string;
  titleId: string;
  language: WidgetLanguage;
  canStartNewChat: boolean;
  onNewChat: () => void;
  onSwitchLanguage: (language: WidgetLanguage) => void;
  onClose: () => void;
}

/** Messenger-style header: the assistant's orb and name, then language, new chat and close. */
export function WidgetHeader({
  botName,
  titleId,
  language,
  canStartNewChat,
  onNewChat,
  onSwitchLanguage,
  onClose,
}: WidgetHeaderProps) {
  const { t } = useTranslation();
  const otherLanguage: WidgetLanguage = language === 'en' ? 'bn' : 'en';

  return (
    <header className="flex shrink-0 items-center gap-2.5 border-b border-line py-2.5 pr-2 pl-3.5">
      <ThinkingOrb state="breathing" size={32} aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="truncate text-[15px] leading-tight font-semibold text-ink">
          {botName}
        </h2>
        <p className="truncate text-xs leading-snug text-ink-muted">{t('widget.subtitle')}</p>
      </div>
      <button
        type="button"
        onClick={() => onSwitchLanguage(otherLanguage)}
        className="h-8 shrink-0 rounded-full border border-line px-2.5 text-xs font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
      >
        <span lang={otherLanguage}>{t('widget.otherLanguage')}</span>
        <span className="sr-only"> ({t('widget.switchLanguage')})</span>
      </button>
      <IconButton
        label={t('widget.newChat')}
        icon={<SquarePen />}
        onClick={onNewChat}
        disabled={!canStartNewChat}
        tooltipSide="bottom"
      />
      <IconButton label={t('widget.close')} icon={<X />} onClick={onClose} tooltipSide="bottom" />
    </header>
  );
}
