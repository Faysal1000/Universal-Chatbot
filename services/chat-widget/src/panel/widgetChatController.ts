import type { i18n } from 'i18next';

import { ChatApiClient } from '@chat-core/api/chatApiClient';
import { createLocalVisitorSessionStore } from '@chat-core/api/localVisitorSessionStore';
import { obtainTurnstileToken } from '@chat-core/api/turnstileVerifier';
import { computeVisitorFingerprint } from '@chat-core/api/visitorFingerprint';
import { ChatController } from '@chat-core/features/chat/chatController';
import { useChatStore } from '@chat-core/features/chat/chatStore';
import {
  createBrowserChatPersistence,
  DEFAULT_BATCHING,
} from '@chat-core/features/message-batching/chatPersistence';
import { showToast } from '@chat-core/shared/ui/toastStore';

import type { WidgetSettings } from '../element/widgetSettings';

/** The publishable key travels with every request; rag checks it against the page's origin. */
const WIDGET_KEY_HEADER = 'X-Widget-Key';
const ACTIVE_CONVERSATION_KEY_SUFFIX = '.activeConversation';

export interface WidgetChatControllerOptions {
  settings: WidgetSettings;
  storageKeyPrefix: string;
  i18n: i18n;
  /** Where Cloudflare may show a challenge: inside the panel, so the page's layout is never touched. */
  turnstileMountPoint: () => HTMLElement;
}

/** The chat app's controller and API client, wired for a website: widget key, namespaced storage, no URLs. */
export function createWidgetChatController(options: WidgetChatControllerOptions): ChatController {
  const { settings, storageKeyPrefix } = options;
  // The client reports a renewed session to the controller, which is created right after it.
  const sessionEvents: { onSessionReplaced: () => void } = { onSessionReplaced: () => undefined };
  const api = new ChatApiClient({
    baseUrl: settings.apiUrl,
    sessionStore: createLocalVisitorSessionStore(storageKeyPrefix),
    computeFingerprint: computeVisitorFingerprint,
    obtainTurnstileToken: () =>
      obtainTurnstileToken(
        useChatStore.getState().config?.turnstileSiteKey ?? null,
        options.turnstileMountPoint(),
      ),
    onSessionReplaced: () => sessionEvents.onSessionReplaced(),
    defaultHeaders: { [WIDGET_KEY_HEADER]: settings.apiKey },
  });
  const controller = new ChatController({
    api,
    batching: DEFAULT_BATCHING,
    persistence: createBrowserChatPersistence(storageKeyPrefix),
    onActiveConversationChange: (conversationId) => saveActiveConversation(storageKeyPrefix, conversationId),
    onNotice: (notice) => showToast(options.i18n.t(`toast.${notice}`)),
  });
  sessionEvents.onSessionReplaced = () => controller.handleSessionReplaced();
  return controller;
}

/** The conversation the visitor last had open, so the next page view continues it. */
export function loadActiveConversation(prefix: string): string | null {
  try {
    return localStorage.getItem(prefix + ACTIVE_CONVERSATION_KEY_SUFFIX);
  } catch {
    return null;
  }
}

function saveActiveConversation(prefix: string, conversationId: string | null): void {
  try {
    const storageKey = prefix + ACTIVE_CONVERSATION_KEY_SUFFIX;
    if (conversationId) localStorage.setItem(storageKey, conversationId);
    else localStorage.removeItem(storageKey);
  } catch {
    // Storage unavailable: the next page view starts a new chat.
  }
}
