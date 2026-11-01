import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'admin-console-theme';

function readAppliedTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** The theme `/theme-init.js` applied before paint, plus a toggle that remembers the choice. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readAppliedTheme);
  const toggleTheme = useCallback(() => {
    const nextTheme: Theme = readAppliedTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }, []);
  return { theme, toggleTheme };
}
