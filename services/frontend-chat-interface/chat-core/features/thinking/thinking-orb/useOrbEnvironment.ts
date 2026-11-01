// Adapted from thinking-orbs by Jakub Antalik (https://github.com/Jakubantalik/thinking-orbs, commit de85557),
// MIT licensed — see ./LICENSE. Changes: strict TypeScript, typed options, only the states this app uses.

import { useEffect, useState, type RefObject } from 'react';

export type OrbTheme = 'auto' | 'dark' | 'light';

/** Nearest ancestor theme: `data-theme="dark|light"` or a `dark`/`light` class. */
function ancestorIsDark(element: Element | null): boolean | null {
  for (let node = element; node; node = node.parentElement) {
    const attribute = node.getAttribute('data-theme');
    if (attribute === 'dark' || node.classList.contains('dark')) return true;
    if (attribute === 'light' || node.classList.contains('light')) return false;
  }
  return null;
}

const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * Whether the orb sits on a dark background: explicit prop → ancestor data-theme/class (watched live) →
 * prefers-color-scheme (subscribed live).
 */
export function useIsDarkBackground(theme: OrbTheme, hostRef: RefObject<Element | null>): boolean {
  const [detectedDark, setDetectedDark] = useState(true);

  useEffect(() => {
    if (theme !== 'auto') return;
    const resolve = () => setDetectedDark(ancestorIsDark(hostRef.current) ?? prefersDark());
    const frame = requestAnimationFrame(resolve);
    const mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', resolve);
    const observer = new MutationObserver(resolve);
    // Inside a shadow root (the website widget) theme changes happen there, not on the page's <html>.
    const themeRoot = hostRef.current?.getRootNode();
    observer.observe(themeRoot instanceof ShadowRoot ? themeRoot : document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
      subtree: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      mediaQuery.removeEventListener('change', resolve);
      observer.disconnect();
    };
  }, [theme, hostRef]);

  return theme === 'auto' ? detectedDark : theme === 'dark';
}

/** Live `prefers-reduced-motion`: those users get a single static frame. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mediaQuery = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
