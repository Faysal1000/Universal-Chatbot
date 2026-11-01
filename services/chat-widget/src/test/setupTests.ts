import '@testing-library/jest-dom/vitest';

// jsdom lacks these browser APIs; the element and the thinking orb need inert stand-ins.
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

HTMLCanvasElement.prototype.getContext = () => null;
