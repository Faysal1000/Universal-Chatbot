import { useCallback, useEffect, useRef, useState } from 'react';

const NEAR_BOTTOM_PX = 120;

/**
 * Follows new content while the user is at the bottom; stops following as soon as they scroll up to read,
 * and exposes `isAtBottom` + `scrollToBottom` for a "jump to latest" button.
 */
export function useStickToBottom<T extends HTMLElement>(contentKey: unknown) {
  const scrollRef = useRef<T>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const stickRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
      stickRef.current = atBottom;
      setIsAtBottom(atBottom);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  // Content changed (new tokens, new messages): follow if the user was at the bottom.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && stickRef.current) element.scrollTop = element.scrollHeight;
  }, [contentKey]);

  // Content can also grow without a state change (images loading, KaTeX layout): observe size.
  useEffect(() => {
    const element = scrollRef.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return { scrollRef, isAtBottom, scrollToBottom };
}
