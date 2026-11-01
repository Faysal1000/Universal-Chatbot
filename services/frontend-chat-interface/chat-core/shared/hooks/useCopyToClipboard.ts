import { useCallback, useEffect, useRef, useState } from 'react';

/** Copies text and exposes a short-lived `copied` flag for button feedback. */
export function useCopyToClipboard(resetAfterMs = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      // The async Clipboard API needs a secure context (https or localhost), which is how this app is served.
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return; // Permission denied: leave the button in its normal state.
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetAfterMs);
    },
    [resetAfterMs],
  );

  return { copied, copy };
}
