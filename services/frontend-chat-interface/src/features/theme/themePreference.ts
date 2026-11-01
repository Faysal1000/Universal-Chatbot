import { create } from 'zustand';

import { readStoredValue, removeStoredValue, writeStoredValue } from '@/shared/safeStorage';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'chat.theme';
const darkQuery = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');

function readStoredPreference(): ThemePreference {
  const stored = readStoredValue(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function applyTheme(preference: ThemePreference): void {
  const resolved = preference === 'system' ? (darkQuery?.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#161619' : '#ffffff');
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()((set) => ({
  preference: readStoredPreference(),
  setPreference: (preference) => {
    if (preference === 'system') removeStoredValue(STORAGE_KEY);
    else writeStoredValue(STORAGE_KEY, preference);
    applyTheme(preference);
    set({ preference });
  },
}));

/** Applies the stored theme before first paint and follows OS changes while on "system". */
export function initializeTheme(): void {
  applyTheme(useThemeStore.getState().preference);
  darkQuery?.addEventListener('change', () => {
    if (useThemeStore.getState().preference === 'system') applyTheme('system');
  });
}

/** Applies the brand accent and picks a readable ink colour for text on it. */
export function applyBrandAccent(hexColor: string): void {
  const match = /^#?([\da-f]{6})$/i.exec(hexColor.trim());
  if (!match?.[1]) return;
  const value = parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  document.documentElement.style.setProperty('--accent', `#${match[1]}`);
  document.documentElement.style.setProperty('--accent-ink', luminance > 0.6 ? '#111111' : '#ffffff');
}
