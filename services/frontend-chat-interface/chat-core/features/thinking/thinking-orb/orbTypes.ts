// Adapted from thinking-orbs by Jakub Antalik (https://github.com/Jakubantalik/thinking-orbs, commit de85557),
// MIT licensed — see ./LICENSE. Changes: strict TypeScript, typed options, only the states this app uses.

/**
 * The orb animations this app uses:
 * - `breathing`: a face-on ring slowly morphing (waiting)
 * - `shaping`: a dotted outline morphing circle → triangle → square (rewriting the question)
 * - `searching`: a scan meridian sweeping a dotted globe (retrieving)
 * - `working`: particles on tilted orbits (reasoning)
 * - `composing`: an undulating multi-band sash (writing the answer)
 */
export type OrbState = 'breathing' | 'shaping' | 'searching' | 'working' | 'composing';

/** 64 and 20 are the upstream hand-tuned sizes; 32 is interpolated between them (see orbPresets.ts). */
export type OrbSize = 64 | 32 | 20;

/** Numeric knobs read by the mode geometry. All optional: each mode supplies its own defaults. */
export interface OrbModeOptions {
  latRings?: number;
  lonDensity?: number;
  rBase?: number;
  rDepth?: number;
  rBoost?: number;
  inkFar?: number;
  inkSpan?: number;
  rsPow?: number;
  rMin?: number;
  scanMul?: number;
  dimBase?: number;
  orbitN?: number;
  ghostN?: number;
  ghostR?: number;
  ghostA?: number;
  particles?: number;
  partR?: number;
  partRDepth?: number;
  lanes?: number;
  segs?: number;
  faceOn?: number;
  spin?: number;
  bandMul?: number;
  wobMul?: number;
  rDot?: number;
  iconD?: number;
  spread?: number;
  rSizeMul?: number;
}

/** One dot of a frame. `white` is the ink value on paper (0 = darkest); it is mirrored on dark themes. */
export interface OrbDot {
  x: number;
  y: number;
  z: number;
  r: number;
  white: number;
  a?: number;
}

/** A finished frame: visible dots, radius-clamped and z-sorted far → near (the draw order). */
export interface OrbFrame {
  dots: OrbDot[];
}

/** Pure geometry for one instant: no canvas, no theme. */
export type OrbModeFrame = (size: number, timeSeconds: number, options: OrbModeOptions) => OrbFrame;
