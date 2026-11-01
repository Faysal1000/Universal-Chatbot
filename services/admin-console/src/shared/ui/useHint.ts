import { useId, useState } from 'react';

/** Hints stay in the DOM for screen readers (aria-describedby) and show on request. */
export function hintClassName(isHintShown: boolean): string {
  return isHintShown ? 'text-xs leading-relaxed text-muted' : 'sr-only';
}

/** State for an ⓘ hint: spread `buttonProps` on a `HintButton` and give the hint text `id` and `textClassName`. */
export function useHint(hintId?: string) {
  const generatedId = useId();
  const id = hintId ?? generatedId;
  const [isHintShown, setIsHintShown] = useState(false);
  return {
    id,
    isHintShown,
    buttonProps: { isHintShown, onToggle: setIsHintShown, hintId: id },
    textClassName: hintClassName(isHintShown),
  };
}
