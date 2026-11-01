// Adapted from thinking-orbs by Jakub Antalik (https://github.com/Jakubantalik/thinking-orbs, commit de85557),
// MIT licensed — see ./LICENSE. Changes: strict TypeScript, typed options, only the states this app uses.
//
// Shared primitives for the dotted 3D orbs: rotated, depth-shaded and z-sorted. Depth is carried by dot size
// and ink weight alone, using plain 2D canvas fills, so every browser renders the same pixels.

import type { OrbDot, OrbFrame } from './orbTypes';

export type Projector = (x: number, y: number, z: number) => [number, number, number];

/** Deterministic hash in [0, 1). */
export function hashD(a: number, b: number): number {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** Stable directions on a unit sphere (Fibonacci lattice). */
export function fibonacciDirection(index: number, count: number): [number, number, number] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (index + 0.5)) / count;
  const radius = Math.sqrt(1 - y * y);
  const angle = index * golden;
  return [radius * Math.cos(angle), y, radius * Math.sin(angle)];
}

/** Shortest signed angular distance, wrapped to (-π, π]. */
export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Spin (yaw) + tilt + orthographic projection into canvas coordinates. */
export function makeProjector(yaw: number, tilt: number, cx: number, cy: number, scale: number): Projector {
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  return (x, y, z) => {
    const x1 = x * cosYaw + z * sinYaw;
    const z1 = -x * sinYaw + z * cosYaw;
    const y1 = y * cosTilt - z1 * sinTilt;
    const z2 = y * sinTilt + z1 * cosTilt;
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}

/** Dot radii were tuned for a 300 px frame; sub-linear scaling keeps small orbs legible. */
export function radiusScale(size: number, power: number): number {
  return (size / 300) ** power;
}

/** Drops invisible dots, clamps radii to the floor and z-sorts far → near into draw order. */
export function finalizeFrame(dots: OrbDot[], minRadius = 0.3): OrbFrame {
  const visible = dots.filter((dot) => (dot.a ?? 1) >= 0.02);
  for (const dot of visible) dot.r = Math.max(minRadius, dot.r);
  visible.sort((a, b) => a.z - b.z);
  return { dots: visible };
}
