import { WifiOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';

import { ImageDropOverlay } from '@chat-core/features/attachments/ImageDropOverlay';
import { useImageAttachmentDrafts } from '@chat-core/features/attachments/useImageAttachmentDrafts';
import { useImageDropZone } from '@chat-core/features/attachments/useImageDropZone';
import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import { useChatStore } from '@chat-core/features/chat/chatStore';
import { DRAFT_CONVERSATION_KEY } from '@chat-core/features/chat/chatThreadModel';
import { useCitationPanelStore } from '@chat-core/features/citations/citationPanelStore';
import { MessageComposer } from '@chat-core/features/composer/MessageComposer';
import { useComposerUiStore } from '@chat-core/features/composer/composerUiStore';
import { ThinkingOrb } from '@chat-core/features/thinking/thinking-orb';
import { ChatThread } from '@chat-core/features/thread/ChatThread';
import { ToastViewport } from '@chat-core/shared/ui/ToastViewport';

import type { WidgetLanguage } from '../element/widgetSettings';
import { WidgetHeader } from './WidgetHeader';
import { WidgetSourceSheet } from './WidgetSourceSheet';
import { PANEL_TITLE_ID } from './panelIds';
import type { PanelUiStore } from './panelUiStore';

const FALLBACK_BOT_NAME = 'Assistant';

interface WidgetPanelProps {
  uiStore: PanelUiStore;
  onRequestClose: () => void;
  onLanguageChange: (language: WidgetLanguage) => void;
  onRetry: () => void;
}

/** The chat inside the panel frame: header, thread, batching pill, composer and the source sheet. */
export function WidgetPanel({ uiStore, onRequestClose, onLanguageChange, onRetry }: WidgetPanelProps) {
  const { t } = useTranslation();
  const controller = useChatController();
  const isOpen = useStore(uiStore, (state) => state.isOpen);
  const language = useStore(uiStore, (state) => state.language);
  const config = useChatStore((state) => state.config);
  const bootstrapStatus = useChatStore((state) => state.bootstrapStatus);
  const bootstrapError = useChatStore((state) => state.bootstrapError);
  const isOnline = useChatStore((state) => state.isOnline);
  const isDraftActive = useChatStore((state) => state.activeConversationKey === DRAFT_CONVERSATION_KEY);
  const hasSelectedCitation = useCitationPanelStore((state) => state.citation !== null);
  const isSourceSheetOpen = hasSelectedCitation && (config?.showSources ?? true);
  const requestComposerFocus = useComposerUiStore((state) => state.requestFocus);
  const attachments = useImageAttachmentDrafts(config?.limits ?? null);
  const { isDraggingFiles, dropZoneProps } = useImageDropZone((files) => void attachments.addFiles(files));
  const chatRef = useRef<HTMLDivElement>(null);
  const botName = config?.botName ?? FALLBACK_BOT_NAME;

  // Opening the panel puts the cursor in the composer (or on the panel while the chat is starting).
  useEffect(() => {
    if (!isOpen) return;
    if (bootstrapStatus === 'ready') requestComposerFocus();
    else chatRef.current?.focus();
  }, [isOpen, bootstrapStatus, requestComposerFocus]);

  const startNewChat = () => {
    void controller.openConversation(null);
    requestComposerFocus();
  };

  return (
    <div
      ref={chatRef}
      tabIndex={-1}
      lang={language}
      className="ucb-chat relative flex min-h-0 flex-1 flex-col bg-canvas text-ink outline-none"
      data-testid="chat-panel"
    >
      <WidgetHeader
        botName={botName}
        titleId={PANEL_TITLE_ID}
        language={language}
        canStartNewChat={bootstrapStatus === 'ready' && !isDraftActive}
        onNewChat={startNewChat}
        onSwitchLanguage={onLanguageChange}
        onClose={onRequestClose}
      />

      <div className="relative flex min-h-0 flex-1 flex-col" inert={isSourceSheetOpen} {...dropZoneProps}>
        {!isOnline && (
          <p
            role="status"
            className="mx-3 mt-2 flex items-center gap-2 rounded-xl bg-warning/15 px-3 py-1.5 text-xs text-warning"
          >
            <WifiOff className="size-3.5 shrink-0" aria-hidden />
            {t('widget.offline')}
          </p>
        )}
        {bootstrapStatus === 'loading' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3" role="status">
            <ThinkingOrb state="breathing" size={64} aria-hidden />
            <p className="text-sm text-ink-muted">{t('widget.loading')}</p>
          </div>
        )}
        {bootstrapStatus === 'error' && (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center"
            role="alert"
          >
            <p className="font-medium text-ink">{t('widget.unavailable')}</p>
            {bootstrapError && <p className="text-sm text-ink-muted">{bootstrapError}</p>}
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
            >
              {t('widget.retry')}
            </button>
          </div>
        )}
        {bootstrapStatus === 'ready' && (
          <>
            <ChatThread botName={botName} />
            <MessageComposer attachments={attachments} botName={botName} />
          </>
        )}
        {isDraggingFiles && <ImageDropOverlay />}
      </div>

      <WidgetSourceSheet />
      <ToastViewport />
    </div>
  );
}
