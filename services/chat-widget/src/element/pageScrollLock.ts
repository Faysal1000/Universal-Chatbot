interface SavedPageStyles {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly htmlOverflow: string;
  readonly bodyPosition: string;
  readonly bodyTop: string;
  readonly bodyLeft: string;
  readonly bodyWidth: string;
  readonly bodyOverflow: string;
}

/**
 * Freezes the page behind the full-screen panel on phones. iOS Safari still scrolls a page whose
 * overflow is hidden, so the body is pinned in place and the scroll position restored on unlock.
 * While locked, `target` follows the visual viewport, so the panel stays above the on-screen keyboard.
 */
export class PageScrollLock {
  private saved: SavedPageStyles | null = null;

  constructor(private readonly target: HTMLElement) {}

  lock(): void {
    if (this.saved !== null) return;
    const html = document.documentElement.style;
    const body = document.body.style;
    this.saved = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      htmlOverflow: html.overflow,
      bodyPosition: body.position,
      bodyTop: body.top,
      bodyLeft: body.left,
      bodyWidth: body.width,
      bodyOverflow: body.overflow,
    };
    html.overflow = 'hidden';
    body.position = 'fixed';
    body.top = `-${this.saved.scrollY}px`;
    body.left = `-${this.saved.scrollX}px`;
    body.width = '100%';
    body.overflow = 'hidden';
    this.followVisualViewport();
    window.visualViewport?.addEventListener('resize', this.followVisualViewport);
    window.visualViewport?.addEventListener('scroll', this.followVisualViewport);
  }

  unlock(): void {
    const saved = this.saved;
    if (saved === null) return;
    this.saved = null;
    window.visualViewport?.removeEventListener('resize', this.followVisualViewport);
    window.visualViewport?.removeEventListener('scroll', this.followVisualViewport);
    this.target.style.removeProperty('--ucb-viewport-height');
    this.target.style.removeProperty('--ucb-viewport-top');
    const html = document.documentElement.style;
    const body = document.body.style;
    html.overflow = saved.htmlOverflow;
    body.position = saved.bodyPosition;
    body.top = saved.bodyTop;
    body.left = saved.bodyLeft;
    body.width = saved.bodyWidth;
    body.overflow = saved.bodyOverflow;
    window.scrollTo(saved.scrollX, saved.scrollY);
  }

  private readonly followVisualViewport = (): void => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    this.target.style.setProperty('--ucb-viewport-height', `${viewport.height}px`);
    this.target.style.setProperty('--ucb-viewport-top', `${viewport.offsetTop}px`);
  };
}
