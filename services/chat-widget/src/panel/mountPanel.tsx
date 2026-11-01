import type { i18n } from 'i18next';
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { ChatControllerContext } from '@chat-core/features/chat/ChatControllerContext';
import type { ChatController } from '@chat-core/features/chat/chatController';
import { TooltipProvider } from '@chat-core/shared/ui/Tooltip';
import { PortalContainerContext } from '@chat-core/shared/ui/portalContainer';

import type { MountPanel } from '../element/panelContract';
import { WidgetPanel } from './WidgetPanel';
import { createWidgetI18n } from './i18n/widgetI18n';
import { installKatexFontsOnPage, katexRules } from './katexStyles';
import panelStyles from './panel.css?inline';
import { PANEL_TITLE_ID } from './panelIds';
import { createPanelUiStore } from './panelUiStore';
import { startWidgetChat } from './startWidgetChat';
import { createWidgetChatController } from './widgetChatController';

/** Fills the panel frame below the element's own markup. */
const FILL_PANEL_STYLE = 'display:flex;flex-direction:column;flex:1;min-height:0';

/**
 * Renders the chat into the element's panel frame. Called once, when the visitor first opens the chat (or in
 * the background when an earlier visit left unsent messages); the element then only toggles visibility.
 */
export const mountPanel: MountPanel = (options) => {
  const shadowRoot = options.mountPoint.getRootNode();
  if (!(shadowRoot instanceof ShadowRoot)) {
    throw new Error('The chat panel must be mounted inside a shadow root');
  }
  const panelSheet = adoptPanelStyles(shadowRoot);
  installKatexFontsOnPage();

  const reactContainer = appendBox(options.mountPoint, FILL_PANEL_STYLE);
  const overlayContainer = appendBox(options.mountPoint, '');
  overlayContainer.className = 'ucb-chat';
  const turnstileContainer = appendBox(options.mountPoint, '');
  options.mountPoint.setAttribute('aria-labelledby', PANEL_TITLE_ID);

  const i18n = createWidgetI18n(options.language);
  const uiStore = createPanelUiStore({
    isOpen: false,
    language: options.language,
  });
  const controller = createWidgetChatController({
    settings: options.settings,
    storageKeyPrefix: options.storageKeyPrefix,
    i18n,
    turnstileMountPoint: () => turnstileContainer,
  });
  const start = () => void startWidgetChat(controller, options.storageKeyPrefix);

  const root = createRoot(reactContainer);
  root.render(
    <StrictMode>
      <PanelProviders controller={controller} i18n={i18n} overlayContainer={overlayContainer}>
        <WidgetPanel
          uiStore={uiStore}
          onRequestClose={options.onRequestClose}
          onLanguageChange={options.onLanguageChange}
          onRetry={start}
        />
      </PanelProviders>
    </StrictMode>,
  );
  start();

  return {
    setOpen: (isOpen) => uiStore.setState({ isOpen }),
    setLanguage: (language) => {
      uiStore.setState({ language });
      void i18n.changeLanguage(language);
    },
    unmount: () => unmountPanel({ root, controller, shadowRoot, panelSheet, mountPoint: options.mountPoint }),
  };
};

function PanelProviders({
  controller,
  i18n,
  overlayContainer,
  children,
}: {
  controller: ChatController;
  i18n: i18n;
  overlayContainer: HTMLElement;
  children: ReactNode;
}) {
  const [container] = useState(overlayContainer);
  return (
    <I18nextProvider i18n={i18n}>
      <ChatControllerContext.Provider value={controller}>
        <PortalContainerContext.Provider value={container}>
          <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
        </PortalContainerContext.Provider>
      </ChatControllerContext.Provider>
    </I18nextProvider>
  );
}

function adoptPanelStyles(shadowRoot: ShadowRoot): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`${panelStyles}\n${katexRules}`);
  shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
  return sheet;
}

function appendBox(parent: HTMLElement, style: string): HTMLDivElement {
  const box = document.createElement('div');
  if (style) box.setAttribute('style', style);
  parent.append(box);
  return box;
}

function unmountPanel(parts: {
  root: ReturnType<typeof createRoot>;
  controller: ChatController;
  shadowRoot: ShadowRoot;
  panelSheet: CSSStyleSheet;
  mountPoint: HTMLElement;
}): void {
  parts.root.unmount();
  parts.controller.dispose();
  parts.shadowRoot.adoptedStyleSheets = parts.shadowRoot.adoptedStyleSheets.filter(
    (sheet) => sheet !== parts.panelSheet,
  );
  parts.mountPoint.replaceChildren();
}
