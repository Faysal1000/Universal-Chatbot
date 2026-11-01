import { WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { appConfig } from '@/config/appConfig';
import {
  CONVERSATION_SEARCH_INPUT_ID,
  ConversationSidebar,
} from '@/features/conversations/ConversationSidebar';
import { ChatHeader } from '@/features/header/ChatHeader';
import { KeyboardShortcutsDialog } from '@/features/shortcuts/KeyboardShortcutsDialog';
import { matchShortcut } from '@/features/shortcuts/keyboardShortcuts';
import { ImageDropOverlay } from '@chat-core/features/attachments/ImageDropOverlay';
import { useImageAttachmentDrafts } from '@chat-core/features/attachments/useImageAttachmentDrafts';
import { useImageDropZone } from '@chat-core/features/attachments/useImageDropZone';
import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import { useChatStore } from '@chat-core/features/chat/chatStore';
import { SourcePreviewPanel } from '@chat-core/features/citations/SourcePreviewPanel';
import { useCitationPanelStore } from '@chat-core/features/citations/citationPanelStore';
import { MessageComposer } from '@chat-core/features/composer/MessageComposer';
import { useComposerUiStore } from '@chat-core/features/composer/composerUiStore';
import { ChatThread } from '@chat-core/features/thread/ChatThread';
import { ToastViewport } from '@chat-core/shared/ui/ToastViewport';
import { cn } from '@chat-core/shared/ui/cn';
import { showToast } from '@chat-core/shared/ui/toastStore';

const DESKTOP_QUERY = '(min-width: 1024px)';

/** The signed-in-anonymously chat layout: sidebar, thread, batching indicator and composer. */
export function ChatApp() {
  const { t } = useTranslation();
  const controller = useChatController();
  const config = useChatStore((state) => state.config);
  const isOnline = useChatStore((state) => state.isOnline);
  const botName = config?.botName ?? appConfig.botName;
  const attachments = useImageAttachmentDrafts(config?.limits ?? null);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  const [isSidebarOpen, setIsSidebarOpen] = useState(isDesktop);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const requestComposerFocus = useComposerUiStore((state) => state.requestFocus);
  const { isDraggingFiles, dropZoneProps } = useImageDropZone((files) => void attachments.addFiles(files));

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      setIsDesktop(query.matches);
      setIsSidebarOpen(query.matches);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const closeSidebarOnMobile = useCallback(() => {
    if (!isDesktop) setIsSidebarOpen(false);
  }, [isDesktop]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = matchShortcut(event);
      if (!action) return;
      switch (action) {
        case 'newChat':
          void controller.openConversation(null);
          requestComposerFocus();
          break;
        case 'search':
          setIsSidebarOpen(true);
          requestAnimationFrame(() => document.getElementById(CONVERSATION_SEARCH_INPUT_ID)?.focus());
          break;
        case 'toggleSidebar':
          setIsSidebarOpen((open) => !open);
          break;
        case 'focusComposer':
          requestComposerFocus();
          break;
        case 'copyLast': {
          const state = useChatStore.getState();
          const last = state.threads[state.activeConversationKey]?.turns.findLast(
            (turn) => turn.reply.content,
          )?.reply.content;
          if (last) {
            void navigator.clipboard.writeText(last).then(() => showToast(t('toast.lastAnswerCopied')));
          }
          break;
        }
        case 'stop':
          // Escape inside dialogs/menus/editors is handled by them first.
          if (event.defaultPrevented || useCitationPanelStore.getState().citation) return;
          if (!useChatStore.getState().streamingTurn) return;
          controller.stopGeneration();
          break;
        case 'showShortcuts':
          setIsShortcutsOpen(true);
          break;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, requestComposerFocus, t]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <a
        href="#message-composer"
        className="sr-only z-50 rounded-lg bg-accent px-3 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('app.skipToComposer')}
      </a>

      {/* Sidebar: static column on desktop, overlay drawer on mobile. */}
      {isSidebarOpen && !isDesktop && (
        <div className="fixed inset-0 z-30 bg-black/40" aria-hidden onClick={() => setIsSidebarOpen(false)} />
      )}
      <aside
        className={cn(
          'z-40 w-[272px] shrink-0 border-r border-line transition-[margin,transform] duration-200',
          isDesktop ? (isSidebarOpen ? 'ml-0' : '-ml-[272px]') : 'fixed inset-y-0 left-0',
          !isDesktop && (isSidebarOpen ? 'translate-x-0' : '-translate-x-full'),
        )}
        aria-hidden={!isSidebarOpen}
        inert={!isSidebarOpen}
      >
        <ConversationSidebar
          botName={botName}
          logoUrl={appConfig.brandLogoUrl}
          onNavigate={closeSidebarOnMobile}
          onClose={() => setIsSidebarOpen(false)}
        />
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col" {...dropZoneProps}>
        <ChatHeader
          isSidebarOpen={isSidebarOpen}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          onShowShortcuts={() => setIsShortcutsOpen(true)}
        />
        {!isOnline && (
          <div
            role="status"
            className="mx-auto mb-2 flex items-center gap-2 rounded-full bg-warning/15 px-3 py-1 text-sm text-warning"
          >
            <WifiOff className="size-4" aria-hidden />
            {t('app.offline')}
          </div>
        )}
        <ChatThread botName={botName} />
        <MessageComposer attachments={attachments} botName={botName} />

        {isDraggingFiles && <ImageDropOverlay />}
      </main>

      <SourcePreviewPanel />
      <KeyboardShortcutsDialog open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen} />
      <ToastViewport />
    </div>
  );
}
