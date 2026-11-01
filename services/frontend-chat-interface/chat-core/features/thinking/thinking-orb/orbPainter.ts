// Adapted from thinking-orbs by Jakub Antalik (https://github.com/Jakubantalik/thinking-orbs, commit de85557),
// MIT licensed — see ./LICENSE. Changes: strict TypeScript, typed options, only the states this app uses.

import type { OrbFrame } from './orbTypes';

/**
 * Paints a finished frame as matte grayscale dots. On dark backgrounds the ink value is mirrored
 * (1 - white) so near dots read bright: the same depth language on an inverted substrate.
 */
export function paintOrbFrame(context: CanvasRenderingContext2D, frame: OrbFrame, isDark: boolean): void {
  for (const dot of frame.dots) {
    const ink = Math.min(1, Math.max(0, dot.white));
    const gray = Math.round((isDark ? 1 - ink : ink) * 255);
    context.fillStyle = `rgba(${gray},${gray},${gray},${dot.a ?? 1})`;
    context.beginPath();
    context.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    context.fill();
  }
}
