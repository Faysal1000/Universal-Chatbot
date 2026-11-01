import type { WidgetLanguage, WidgetSettings } from './widgetSettings';

/**
 * The boundary between the always-loaded element and the lazily loaded chat panel. Only types cross it, so the
 * launcher's bundle never pulls in the panel's code.
 */
export interface PanelMountOptions {
  /** Inside the panel frame, in the element's shadow root. */
  mountPoint: HTMLElement;
  settings: WidgetSettings;
  language: WidgetLanguage;
  /** Every localStorage key of this widget starts with it. */
  storageKeyPrefix: string;
  /** The visitor asked to close (header button, Escape inside the chat). */
  onRequestClose: () => void;
  onLanguageChange: (language: WidgetLanguage) => void;
}

export interface PanelHandle {
  setOpen(isOpen: boolean): void;
  setLanguage(language: WidgetLanguage): void;
  unmount(): void;
}

export type MountPanel = (options: PanelMountOptions) => PanelHandle;
