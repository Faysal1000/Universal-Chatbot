const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Focusable elements of `container` in tab order, skipping hidden and inert ones. */
export function tabbableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (element) => !element.closest('[inert]') && element.getClientRects().length > 0,
  );
}

/**
 * Keeps Tab and Shift+Tab inside the open panel. Works inside a shadow root, where `document.activeElement` is
 * only the host element, by asking the root for the real focused element.
 */
export function trapTabKey(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const tabbables = tabbableElements(container);
  const first = tabbables.at(0);
  const last = tabbables.at(-1);
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const root = container.getRootNode() as Document | ShadowRoot;
  const active = root.activeElement;
  const isInside = active instanceof HTMLElement && container.contains(active);
  if (event.shiftKey && (active === first || !isInside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !isInside)) {
    event.preventDefault();
    first.focus();
  }
}
