export type ShortcutAction =
  'newChat' | 'search' | 'toggleSidebar' | 'focusComposer' | 'copyLast' | 'stop' | 'showShortcuts';

export interface ShortcutDefinition {
  action: ShortcutAction;
  key: string;
  mod?: boolean;
  shift?: boolean;
  /** Keys shown in the shortcuts dialog. */
  display: string[];
}

const isMacPlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY_LABEL = isMacPlatform ? '⌘' : 'Ctrl';

/** Global shortcuts (ChatGPT-compatible where one exists). Composer-local keys are documented separately. */
export const GLOBAL_SHORTCUTS: ShortcutDefinition[] = [
  { action: 'newChat', key: 'o', mod: true, shift: true, display: [MOD_KEY_LABEL, 'Shift', 'O'] },
  { action: 'search', key: 'k', mod: true, display: [MOD_KEY_LABEL, 'K'] },
  { action: 'toggleSidebar', key: 's', mod: true, shift: true, display: [MOD_KEY_LABEL, 'Shift', 'S'] },
  { action: 'focusComposer', key: 'Escape', shift: true, display: ['Shift', 'Esc'] },
  { action: 'copyLast', key: 'c', mod: true, shift: true, display: [MOD_KEY_LABEL, 'Shift', 'C'] },
  { action: 'stop', key: 'Escape', display: ['Esc'] },
  { action: 'showShortcuts', key: '/', mod: true, display: [MOD_KEY_LABEL, '/'] },
];

export function matchShortcut(event: KeyboardEvent): ShortcutAction | null {
  const mod = isMacPlatform ? event.metaKey : event.ctrlKey;
  for (const shortcut of GLOBAL_SHORTCUTS) {
    if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) continue;
    if (Boolean(shortcut.mod) !== mod) continue;
    if (Boolean(shortcut.shift) !== event.shiftKey) continue;
    if (event.altKey) continue;
    return shortcut.action;
  }
  return null;
}
