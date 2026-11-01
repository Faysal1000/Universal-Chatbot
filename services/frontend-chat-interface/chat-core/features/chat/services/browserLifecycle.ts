export interface BrowserLifecycleHandlers {
  /** The tab was hidden: a good moment to send pending batches. */
  onHidden: () => void;
  onOnlineChange: (isOnline: boolean) => void;
}

export interface BrowserLifecycle {
  /** True between `pagehide` and `pageshow`: requests killed by an unload must not be treated as settled. */
  readonly isPageUnloading: boolean;
  dispose(): void;
}

/** Subscribes to the page/network lifecycle events the chat cares about. */
export function watchBrowserLifecycle(handlers: BrowserLifecycleHandlers): BrowserLifecycle {
  const state = { isPageUnloading: false };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') handlers.onHidden();
  };
  const onPageHide = () => {
    state.isPageUnloading = true;
  };
  const onPageShow = () => {
    state.isPageUnloading = false;
  };
  const onOnline = () => handlers.onOnlineChange(true);
  const onOffline = () => handlers.onOnlineChange(false);

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return {
    get isPageUnloading() {
      return state.isPageUnloading;
    },
    dispose() {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    },
  };
}
