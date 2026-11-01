// Adapted from thinking-orbs by Jakub Antalik (https://github.com/Jakubantalik/thinking-orbs, commit de85557),
// MIT licensed — see ./LICENSE. Changes: strict TypeScript, typed options, only the states this app uses.

import { useEffect, useRef, type CanvasHTMLAttributes } from 'react';

import { paintOrbFrame } from './orbPainter';
import { resolveOrbPreset } from './orbPresets';
import type { OrbSize, OrbState } from './orbTypes';
import { useIsDarkBackground, usePrefersReducedMotion, type OrbTheme } from './useOrbEnvironment';

interface ThinkingOrbProps extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, 'children'> {
  state?: OrbState;
  size?: OrbSize;
  theme?: OrbTheme;
  /** Multiplier on the preset's tuned speed. */
  speed?: number;
  /** Freeze on the current frame (e.g. finished replies, so long threads don't animate dozens of canvases). */
  paused?: boolean;
}

/** Time of the representative frame shown to reduced-motion users. */
const STATIC_FRAME_SECONDS = 0.6;
const MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * Animated dotted "thinking" orb on a 2D canvas. All instances share one clock (performance.now) so they stay in
 * phase; each pauses while offscreen or while the tab is hidden.
 */
export function ThinkingOrb({
  state = 'working',
  size = 64,
  theme = 'auto',
  speed = 1,
  paused = false,
  style,
  ...canvasProps
}: ThinkingOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDark = useIsDarkBackground(theme, canvasRef);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const pixelRatio = Math.min(MAX_DEVICE_PIXEL_RATIO, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * pixelRatio);
    canvas.height = Math.round(size * pixelRatio);
    const { frame, speed: presetSpeed, options } = resolveOrbPreset(state, size);
    const drawAt = (seconds: number) => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, size, size);
      paintOrbFrame(context, frame(size, seconds, options), isDark);
    };
    const now = () => (performance.now() / 1000) * presetSpeed * speed;

    if (reducedMotion) {
      drawAt(STATIC_FRAME_SECONDS);
      return;
    }
    drawAt(now());
    if (paused) return;

    let animationFrame = 0;
    let isRunning = false;
    let isOnScreen = true;
    const loop = () => {
      drawAt(now());
      if (isRunning) animationFrame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (isRunning || !isOnScreen || document.visibilityState === 'hidden') return;
      isRunning = true;
      animationFrame = requestAnimationFrame(loop);
    };
    const stop = () => {
      isRunning = false;
      cancelAnimationFrame(animationFrame);
    };
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      isOnScreen = entry?.isIntersecting ?? true;
      if (isOnScreen) start();
      else stop();
    });
    visibilityObserver.observe(canvas);
    const onVisibilityChange = () => (document.visibilityState === 'hidden' ? stop() : start());
    document.addEventListener('visibilitychange', onVisibilityChange);
    start();

    return () => {
      stop();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [state, size, isDark, speed, paused, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      style={{ width: size, height: size, display: 'block', ...style }}
      {...canvasProps}
    />
  );
}
