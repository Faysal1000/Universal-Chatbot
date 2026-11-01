import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Check,
  Keyboard,
  Languages,
  Monitor,
  Moon,
  PanelLeftOpen,
  Settings,
  SquarePen,
  Sun,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useThemeStore, type ThemePreference } from '@/features/theme/themePreference';
import type { SupportedLanguage } from '@/config/appConfig';
import { setLanguage, SUPPORTED_LANGUAGES } from '@/i18n/i18n';
import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import { useChatStore } from '@chat-core/features/chat/chatStore';
import { IconButton } from '@chat-core/shared/ui/IconButton';

interface ChatHeaderProps {
  isSidebarOpen: boolean;
  onOpenSidebar: () => void;
  onShowShortcuts: () => void;
}

const THEME_OPTIONS: {
  value: ThemePreference;
  icon: typeof Sun;
  labelKey: 'header.themeLight' | 'header.themeDark' | 'header.themeSystem';
}[] = [
  { value: 'light', icon: Sun, labelKey: 'header.themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'header.themeDark' },
  { value: 'system', icon: Monitor, labelKey: 'header.themeSystem' },
];

const itemClass =
  'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink outline-none data-highlighted:bg-surface';

export function ChatHeader({ isSidebarOpen, onOpenSidebar, onShowShortcuts }: ChatHeaderProps) {
  const { t, i18n } = useTranslation();
  const controller = useChatController();
  const title = useChatStore(
    (state) => state.conversations.find((c) => c.id === state.activeConversationKey)?.title,
  );
  const { preference, setPreference } = useThemeStore();

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3">
      {!isSidebarOpen && (
        <>
          <IconButton
            label={t('sidebar.open')}
            icon={<PanelLeftOpen />}
            onClick={onOpenSidebar}
            tooltipSide="bottom"
          />
          <IconButton
            label={t('sidebar.newChat')}
            icon={<SquarePen />}
            onClick={() => void controller.openConversation(null)}
            tooltipSide="bottom"
          />
        </>
      )}
      <h1 className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-ink">{title ?? ''}</h1>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton label={t('header.settings')} icon={<Settings />} tooltipSide="bottom" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-52 rounded-xl border border-line bg-canvas p-1 shadow-elevated"
          >
            <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-ink-subtle">
              {t('header.theme')}
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              value={preference}
              onValueChange={(value) => setPreference(value as ThemePreference)}
            >
              {THEME_OPTIONS.map(({ value, icon: Icon, labelKey }) => (
                <DropdownMenu.RadioItem key={value} value={value} className={itemClass}>
                  <Icon className="size-4" aria-hidden />
                  {t(labelKey)}
                  <DropdownMenu.ItemIndicator className="ml-auto">
                    <Check className="size-4" aria-hidden />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Label className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1 text-xs font-medium text-ink-subtle">
              <Languages className="size-3.5" aria-hidden />
              {t('header.language')}
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              value={i18n.language}
              onValueChange={(value) => setLanguage(value as SupportedLanguage)}
            >
              {SUPPORTED_LANGUAGES.map((language) => (
                <DropdownMenu.RadioItem
                  key={language.code}
                  value={language.code}
                  className={itemClass}
                  lang={language.code}
                >
                  {language.nativeName}
                  <DropdownMenu.ItemIndicator className="ml-auto">
                    <Check className="size-4" aria-hidden />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item className={itemClass} onSelect={onShowShortcuts}>
              <Keyboard className="size-4" aria-hidden />
              {t('header.shortcuts')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  );
}
