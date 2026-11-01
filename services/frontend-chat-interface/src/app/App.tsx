import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { appConfig } from '@/config/appConfig';
import { i18next } from '@/i18n/i18n';
import { ChatApiClient } from '@chat-core/api/chatApiClient';
import { createLocalVisitorSessionStore } from '@chat-core/api/localVisitorSessionStore';
import { obtainTurnstileToken } from '@chat-core/api/turnstileVerifier';
import { computeVisitorFingerprint } from '@chat-core/api/visitorFingerprint';
import { ChatControllerContext } from '@chat-core/features/chat/ChatControllerContext';
import { ChatController } from '@chat-core/features/chat/chatController';
import { useChatStore } from '@chat-core/features/chat/chatStore';
import { createBrowserChatPersistence } from '@chat-core/features/message-batching/chatPersistence';
import { ThinkingOrb } from '@chat-core/features/thinking/thinking-orb';
import { TooltipProvider } from '@chat-core/shared/ui/Tooltip';
import { showToast } from '@chat-core/shared/ui/toastStore';

import { ChatApp } from './ChatApp';
import { conversationIdFromPath, writeConversationToUrl } from './conversationRoute';

/** Prefix of every localStorage key the app writes; the website widget uses its own. */
const STORAGE_KEY_PREFIX = 'chat';

function createChatController(): ChatController {
  // The client reports a renewed session to the controller, which is created right after it.
  const sessionEvents: { onSessionReplaced: () => void } = { onSessionReplaced: () => undefined };
  const api = new ChatApiClient({
    baseUrl: appConfig.apiBaseUrl,
    sessionStore: createLocalVisitorSessionStore(STORAGE_KEY_PREFIX),
    computeFingerprint: computeVisitorFingerprint,
    obtainTurnstileToken: () =>
      obtainTurnstileToken(useChatStore.getState().config?.turnstileSiteKey ?? null),
    onSessionReplaced: () => sessionEvents.onSessionReplaced(),
  });
  const controller = new ChatController({
    api,
    batching: appConfig.batching,
    persistence: createBrowserChatPersistence(STORAGE_KEY_PREFIX),
    onConfigLoaded: (config) => {
      document.title = config.botName;
    },
    onActiveConversationChange: writeConversationToUrl,
    onNotice: (notice) => showToast(i18next.t(`toast.${notice}`)),
  });
  sessionEvents.onSessionReplaced = () => controller.handleSessionReplaced();
  return controller;
}

export function App() {
  const { t } = useTranslation();
  const [controller] = useState(createChatController);
  const bootstrapStatus = useChatStore((state) => state.bootstrapStatus);
  const bootstrapError = useChatStore((state) => state.bootstrapError);

  useEffect(() => {
    void controller.initialize(conversationIdFromPath());
    const onPopState = () => void controller.openConversation(conversationIdFromPath(), { updateUrl: false });
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      controller.dispose();
    };
  }, [controller]);

  if (bootstrapStatus === 'loading') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4" role="status">
        <ThinkingOrb state="breathing" size={64} aria-hidden />
        <p className="text-sm text-ink-muted">{t('app.loading')}</p>
      </div>
    );
  }

  if (bootstrapStatus === 'error') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
        <p className="font-medium text-ink">{t('app.bootstrapFailed')}</p>
        {bootstrapError && <p className="text-sm text-ink-muted">{bootstrapError}</p>}
        <button
          type="button"
          onClick={() => void controller.initialize(conversationIdFromPath())}
          className="mt-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          {t('app.retry')}
        </button>
      </div>
    );
  }

  return (
    <ChatControllerContext.Provider value={controller}>
      <TooltipProvider delayDuration={400}>
        <ChatApp />
      </TooltipProvider>
    </ChatControllerContext.Provider>
  );
}
