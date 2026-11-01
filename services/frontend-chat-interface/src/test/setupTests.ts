import '@testing-library/jest-dom/vitest';
import '@/i18n/i18n';

// jsdom lacks these browser APIs; the thinking orb and media-query hooks need inert stand-ins.
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

class InertIntersectionObserver {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
  takeRecords = () => [];
}
globalThis.IntersectionObserver = InertIntersectionObserver as unknown as typeof IntersectionObserver;

HTMLCanvasElement.prototype.getContext = () => null;
