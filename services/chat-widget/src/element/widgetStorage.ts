import type { WidgetLanguage } from './widgetSettings';

/** One namespace per publishable key: two widgets of different sites on one origin never share state. */
export function storageKeyPrefixFor(apiKey: string): string {
  return `universal-chat-bot.${apiKey}`;
}

/** The visitor's own language choice (the panel's language switch) beats the site's `language` attribute. */
export function loadLanguagePreference(prefix: string): WidgetLanguage | null {
  const stored = readStorage(`${prefix}.language`);
  return stored === 'en' || stored === 'bn' ? stored : null;
}

export function saveLanguagePreference(prefix: string, language: WidgetLanguage): void {
  try {
    localStorage.setItem(`${prefix}.language`, language);
  } catch {
    // Storage blocked (privacy mode, sandboxed iframe): the choice lasts for this page view only.
  }
}

/**
 * Messages the visitor wrote but that never reached the server (the tab closed inside the batching window, or
 * mid-request). When there are any, the panel loads in the background right away so they are sent.
 */
export function hasUnsentMessages(prefix: string): boolean {
  const pending = readStorage(`${prefix}.pendingBatches.v1`);
  const inFlight = readStorage(`${prefix}.inFlightTurns.v1`);
  return (pending !== null && pending !== '{}') || (inFlight !== null && inFlight !== '[]');
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
