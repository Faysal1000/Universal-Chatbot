import type { WidgetLanguage } from './widgetSettings';

/** The few strings the launcher needs before the panel (and its full translations) has loaded. */
export interface LauncherCopy {
  label: string;
  close: string;
  dialog: string;
  /** Shown in the panel when its code could not be fetched. */
  loadFailed: string;
}

export const LAUNCHER_COPY: Record<WidgetLanguage, LauncherCopy> = {
  en: {
    label: 'Chat',
    close: 'Close chat',
    dialog: 'Chat',
    loadFailed: 'The chat could not be loaded. Check your connection and open it again.',
  },
  bn: {
    label: 'চ্যাট',
    close: 'চ্যাট বন্ধ করুন',
    dialog: 'চ্যাট',
    loadFailed: 'চ্যাট লোড করা যায়নি। সংযোগ পরীক্ষা করে আবার খুলুন।',
  },
};
