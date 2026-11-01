// Adapted from thinking-orbs by Jakub Antalik (https://github.com/Jakubantalik/thinking-orbs, commit de85557),
// MIT licensed — see ../LICENSE. Changes: strict TypeScript, typed options, only the states this app uses.
//
// Lat/long dot-field mode: "searching" (a globe with a sweeping scan meridian).

import { angleDelta, finalizeFrame, makeProjector, radiusScale } from '../orbGeometry';
import type { OrbDot, OrbModeFrame } from '../orbTypes';

type Vector3 = [number, number, number];

/** Visits every point of a latitude/longitude lattice on the unit sphere. */
function forEachLatticePoint(
  latRings: number,
  lonDensity: number,
  visit: (point: Vector3, longitude: number) => void,
) {
  for (let ring = 0; ring <= latRings; ring++) {
    const latitude = -Math.PI / 2 + (ring / latRings) * Math.PI;
    const cosLat = Math.cos(latitude);
    const sinLat = Math.sin(latitude);
    const lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
    for (let j = 0; j < lonCount; j++) {
      const longitude = (j / lonCount) * 2 * Math.PI;
      visit([cosLat * Math.cos(longitude), sinLat, cosLat * Math.sin(longitude)], longitude);
    }
  }
}

// ── searching ──────────────────────────────────────────────────────────────────────────────────────────

export const frameGlobe: OrbModeFrame = (size, t, o) => {
  const spin = 0.5;
  const center = size / 2;
  const tilt = 0.4 + 0.06 * Math.sin(t * 0.35);
  const project = makeProjector(t * spin, tilt, center, center, (size / 2) * 0.82);
  const scanAngle = t * (spin + (1.7 - spin) * (o.scanMul ?? 1));
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const dimBase = o.dimBase ?? 1;
  const dots: OrbDot[] = [];

  forEachLatticePoint(o.latRings ?? 17, o.lonDensity ?? 44, ([px, py, pz], longitude) => {
    const [x, y, z] = project(px, py, pz);
    const depth = (z + 1) / 2;
    // The scan reads as a size ripple travelling along a meridian, not a shine.
    const distance = angleDelta(longitude + t * spin, scanAngle);
    const boost = Math.exp(-(distance * distance) / 0.18) * Math.max(0, z);
    dots.push({
      x,
      y,
      z,
      r: ((o.rBase ?? 0.6) + (o.rDepth ?? 1.7) * depth + (o.rBoost ?? 1) * boost) * rs,
      white: (o.inkFar ?? 0.62) - (o.inkSpan ?? 0.54) * depth,
      a: dimBase + (1 - dimBase) * Math.min(1, boost),
    });
  });
  return finalizeFrame(dots, o.rMin);
};
