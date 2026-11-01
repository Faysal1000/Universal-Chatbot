// Adapted from thinking-orbs by Jakub Antalik (https://github.com/Jakubantalik/thinking-orbs, commit de85557),
// MIT licensed — see ../LICENSE. Changes: strict TypeScript, typed options, only the states this app uses.
//
// "composing": an undulating sash of parallel strands on a great circle (spin 0 freezes the 3D tumble).
// "breathing" reuses it with `faceOn`: a face-on ring whose radius, not its out-of-plane offset, undulates.

import { fibonacciDirection, finalizeFrame, makeProjector, radiusScale } from '../orbGeometry';
import type { OrbDot, OrbModeFrame } from '../orbTypes';

const CAMERA_TILT = 0.3;

export const frameRibbon: OrbModeFrame = (size, t, o) => {
  const center = size / 2;
  const sphereRadius = (size / 2) * 0.78;
  const spin = o.spin ?? 1;
  const isFaceOn = Boolean(o.faceOn);
  const project = makeProjector(t * 0.1 * spin, CAMERA_TILT, center, center, 1);
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const dots: OrbDot[] = [];

  const ghostCount = o.ghostN ?? 150;
  for (let i = 0; i < ghostCount; i++) {
    const [dx, dy, dz] = fibonacciDirection(i, ghostCount);
    const [x, y, z] = project(dx * sphereRadius, dy * sphereRadius, dz * sphereRadius);
    const depth = (z / sphereRadius + 1) / 2;
    dots.push({ x, y, z, r: 0.8 * rs, white: 0.78, a: 0.1 + 0.22 * depth });
  }

  // Band plane (precessing unless spin = 0). Face-on cancels the camera tilt so the band is a true circle.
  const yawAngle = t * 0.24 * spin;
  const tiltAngle = isFaceOn ? -CAMERA_TILT : 0.55 + 0.3 * Math.sin(t * 0.18) * spin;
  const ux = Math.cos(yawAngle);
  const uy = 0;
  const uz = Math.sin(yawAngle);
  const vx = -uz * Math.sin(tiltAngle);
  const vy = Math.cos(tiltAngle);
  const vz = ux * Math.sin(tiltAngle);
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;

  // Radial lobes swell past the radius, so face-on pulls the base radius in to keep the silhouette in frame.
  const wobbleScale = o.wobMul ?? 1;
  const baseRadius = isFaceOn ? sphereRadius / (1 + 0.85 * 0.23 * wobbleScale) : sphereRadius;
  const lanes = Math.max(1, Math.round((o.lanes ?? 5) * (o.bandMul ?? 1)));
  const segments = o.segs ?? 88;
  const laneMiddle = (lanes - 1) / 2;

  for (let lane = 0; lane < lanes; lane++) {
    const laneOffset = (lane - laneMiddle) * 0.075;
    const edge = Math.abs(lane - laneMiddle) / Math.max(1, laneMiddle);
    for (let k = 0; k < segments; k++) {
      const a = (k / segments) * 2 * Math.PI;
      const wobble =
        (0.16 * Math.sin(a * 3 - t * 1.7 + lane * 0.22) + 0.07 * Math.sin(a * 5 + t * 1.1)) * wobbleScale;
      const radial = isFaceOn ? 1 + wobble : 1;
      const offset = isFaceOn ? laneOffset : laneOffset + wobble;
      const px = ux * Math.cos(a) + vx * Math.sin(a) + nx * offset;
      const py = uy * Math.cos(a) + vy * Math.sin(a) + ny * offset;
      const pz = uz * Math.cos(a) + vz * Math.sin(a) + nz * offset;
      const length = Math.hypot(px, py, pz);
      const r = baseRadius * radial;
      const [x, y, z] = project((px / length) * r, (py / length) * r, (pz / length) * r);
      const depth = (z / sphereRadius + 1) / 2;
      dots.push({
        x,
        y,
        z,
        r: ((o.rBase ?? 1.1) + (o.rDepth ?? 1.7) * depth) * (1 - 0.25 * edge) * rs,
        white: 0.52 - 0.44 * depth + 0.18 * edge,
        a: 0.4 + 0.6 * depth,
      });
    }
  }
  return finalizeFrame(dots, o.rMin);
};
