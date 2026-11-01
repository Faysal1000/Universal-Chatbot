// Adapted from thinking-orbs by Jakub Antalik (https://github.com/Jakubantalik/thinking-orbs, commit de85557),
// MIT licensed — see ./LICENSE. Changes: strict TypeScript, typed options, only the states this app uses.
//
// Tuned presets per state and size. The base profiles are the upstream "fine" density profiles; a preset applies
// count / radius multipliers on top and a speed multiplier on the shared clock. Resolved once per (state, size).

import { frameMorph } from './modes/morphMode';
import { frameOrbits } from './modes/orbitsMode';
import { frameRibbon } from './modes/ribbonMode';
import { frameGlobe } from './modes/sphereLatticeModes';
import type { OrbModeFrame, OrbModeOptions, OrbSize, OrbState } from './orbTypes';

type TunedSize = 64 | 20;

interface Preset {
  speed: number;
  count: number;
  size: number;
  /** Extra options merged verbatim after scaling. */
  extra?: OrbModeOptions;
}

interface StateDefinition {
  frame: OrbModeFrame;
  baseOptions: OrbModeOptions;
  presets: Record<TunedSize, Preset>;
}

const LATTICE_INK = { inkFar: 0.62, inkSpan: 0.54, rsPow: 0.6, rMin: 0.3 } satisfies OrbModeOptions;
const RIBBON_BASE = {
  lanes: 5,
  segs: 88,
  rBase: 1.1,
  rDepth: 1.7,
  rsPow: 0.6,
  rMin: 0.3,
} satisfies OrbModeOptions;

const STATE_DEFINITIONS: Record<OrbState, StateDefinition> = {
  working: {
    frame: frameOrbits,
    baseOptions: {
      orbitN: 12,
      ghostN: 40,
      ghostR: 0.9,
      ghostA: 0.5,
      particles: 3,
      partR: 1.2,
      partRDepth: 1.6,
      rsPow: 0.6,
      rMin: 0.3,
    },
    presets: { 64: { speed: 1.885, count: 1, size: 1 }, 20: { speed: 3.9, count: 0.238, size: 2.4 } },
  },
  searching: {
    frame: frameGlobe,
    baseOptions: { latRings: 17, lonDensity: 44, rBase: 0.6, rDepth: 1.7, rBoost: 1, ...LATTICE_INK },
    presets: {
      64: { speed: 2.015, count: 0.42, size: 1.15, extra: { scanMul: 4.08, dimBase: 0.45 } },
      20: { speed: 2.665, count: 0.105, size: 1.75, extra: { scanMul: 4.335, dimBase: 0.45 } },
    },
  },
  composing: {
    frame: frameRibbon,
    baseOptions: { ...RIBBON_BASE, ghostN: 150 },
    presets: {
      64: { speed: 2.34, count: 0.25, size: 0.85, extra: { spin: 0, bandMul: 3.9, wobMul: 1 } },
      20: { speed: 3.12, count: 0.051, size: 1.073, extra: { spin: 0, bandMul: 4.94, wobMul: 1 } },
    },
  },
  breathing: {
    frame: frameRibbon,
    // Ribbon geometry, face-on, without the ghost sphere behind it.
    baseOptions: { ...RIBBON_BASE, ghostN: 0, faceOn: 1 },
    presets: {
      64: { speed: 3.24, count: 0.25, size: 0.956, extra: { spin: 0, bandMul: 3.627, wobMul: 0.368 } },
      20: { speed: 3.78, count: 0.028, size: 1.622, extra: { spin: 0, bandMul: 3.968, wobMul: 0.565 } },
    },
  },
  shaping: {
    frame: frameMorph,
    baseOptions: { rDot: 0.021, iconD: 1, rMin: 0.25 },
    presets: {
      64: { speed: 2.405, count: 0.702, size: 0.395, extra: { spread: 1.45 } },
      20: { speed: 2.08, count: 0.53, size: 1.011, extra: { spread: 1.45 } },
    },
  },
};

// 2-D lattices come in pairs: each side takes √scale so the TOTAL dot count scales by `scale`.
const COUNT_PAIRS: readonly (readonly [keyof OrbModeOptions, keyof OrbModeOptions])[] = [
  ['latRings', 'lonDensity'],
  ['lanes', 'segs'],
];
const COUNT_KEYS: readonly (keyof OrbModeOptions)[] = ['orbitN', 'ghostN'];
// Every key that sets a dot's radius: scaling all of them keeps the near/far falloff intact.
const RADIUS_KEYS: readonly (keyof OrbModeOptions)[] = [
  'rBase',
  'rDepth',
  'rDot',
  'ghostR',
  'partR',
  'partRDepth',
];

export function scaleCounts(options: OrbModeOptions, scale: number): OrbModeOptions {
  const scaled: OrbModeOptions = { ...options };
  const root = Math.sqrt(scale);
  for (const [a, b] of COUNT_PAIRS) {
    const valueA = scaled[a];
    const valueB = scaled[b];
    if (valueA === undefined || valueB === undefined) continue;
    scaled[a] = Math.max(2, Math.round(valueA * root));
    scaled[b] = Math.max(2, Math.round(valueB * root));
  }
  for (const key of COUNT_KEYS) {
    const value = scaled[key];
    // 0 means the state opted out of that layer (breathing has no ghost sphere): never resurrect it.
    if (value !== undefined && value !== 0) scaled[key] = Math.max(1, Math.round(value * scale));
  }
  if (scaled.iconD !== undefined) scaled.iconD = Math.max(0.02, scaled.iconD * scale);
  return scaled;
}

export function scaleRadii(options: OrbModeOptions, scale: number): OrbModeOptions {
  const scaled: OrbModeOptions = { ...options };
  for (const key of RADIUS_KEYS) {
    const value = scaled[key];
    if (value !== undefined) scaled[key] = value * scale;
  }
  scaled.rSizeMul = (scaled.rSizeMul ?? 1) * scale;
  return scaled;
}

/**
 * Upstream ships hand-tuned 64 px and 20 px designs. For the 32 px chat avatar the multipliers are interpolated
 * between them in log space (they are ratios), weighted by where 32 sits between 64 and 20 on a log scale.
 */
const INTERPOLATION_WEIGHT_32 = Math.log(64 / 32) / Math.log(64 / 20);
const logLerp = (from: number, to: number) =>
  Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * INTERPOLATION_WEIGHT_32);

function interpolatedPreset(large: Preset, small: Preset): Preset {
  const extra: OrbModeOptions = { ...large.extra };
  for (const key of Object.keys(extra) as (keyof OrbModeOptions)[]) {
    const from = large.extra?.[key];
    const to = small.extra?.[key];
    if (from !== undefined && to !== undefined) extra[key] = from > 0 && to > 0 ? logLerp(from, to) : from;
  }
  return {
    speed: logLerp(large.speed, small.speed),
    count: logLerp(large.count, small.count),
    size: logLerp(large.size, small.size),
    extra,
  };
}

export interface ResolvedOrb {
  frame: OrbModeFrame;
  speed: number;
  options: OrbModeOptions;
}

const resolvedCache = new Map<string, ResolvedOrb>();

/** Resolves a (state, size) pair to its frame function, speed and fully scaled options. Cached. */
export function resolveOrbPreset(state: OrbState, size: OrbSize): ResolvedOrb {
  const cacheKey = `${state}-${size}`;
  const cached = resolvedCache.get(cacheKey);
  if (cached) return cached;

  const definition = STATE_DEFINITIONS[state];
  const preset =
    size === 32
      ? interpolatedPreset(definition.presets[64], definition.presets[20])
      : definition.presets[size];
  let options: OrbModeOptions = { ...definition.baseOptions };
  if (preset.count !== 1) options = scaleCounts(options, preset.count);
  if (preset.size !== 1) options = scaleRadii(options, preset.size);
  if (preset.extra) options = { ...options, ...preset.extra };

  const resolved: ResolvedOrb = { frame: definition.frame, speed: preset.speed, options };
  resolvedCache.set(cacheKey, resolved);
  return resolved;
}
