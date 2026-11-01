/** Keyboard movement through a list of pages (roving focus): arrows step, Home/End jump. */
const KEY_STEPS: Readonly<Record<string, (currentIndex: number, lastIndex: number) => number>> = {
  ArrowDown: (currentIndex, lastIndex) => Math.min(currentIndex + 1, lastIndex),
  ArrowRight: (currentIndex, lastIndex) => Math.min(currentIndex + 1, lastIndex),
  ArrowUp: (currentIndex) => Math.max(currentIndex - 1, 0),
  ArrowLeft: (currentIndex) => Math.max(currentIndex - 1, 0),
  Home: () => 0,
  End: (_currentIndex, lastIndex) => lastIndex,
};

/** The index the key moves to, or null when the key does not navigate. */
export function pageIndexAfterKey(key: string, currentIndex: number, pageCount: number): number | null {
  const step = KEY_STEPS[key];
  if (step === undefined || pageCount === 0) return null;
  return step(currentIndex, pageCount - 1);
}
