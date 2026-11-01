import { createContext, useContext } from 'react';

/**
 * Where overlays (dialogs, tooltips) render. The chat app leaves it unset, so they portal to `document.body`;
 * the website widget points it inside its shadow root, where its styles apply and the host page's do not.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

/** `null` means the default, `document.body`. */
export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext);
}
