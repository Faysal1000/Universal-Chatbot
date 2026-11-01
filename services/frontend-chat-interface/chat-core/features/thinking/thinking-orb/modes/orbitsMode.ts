// Adapted from thinking-orbs by Jakub Antalik (https://github.com/Jakubantalik/thinking-orbs, commit de85557),
// MIT licensed — see ../LICENSE. Changes: strict TypeScript, typed options, only the states this app uses.
//
// "working": particles on tilted orbits, with faint ghost paths and no nucleus.

import { finalizeFrame, hashD, makeProjector, radiusScale } from '../orbGeometry';
import type { OrbDot, OrbModeFrame } from '../orbTypes';

export const frameOrbits: OrbModeFrame = (size, t, o) => {
  const center = size / 2;
  const sphereRadius = (size / 2) * 0.82;
  const project = makeProjector(t * 0.12, 0.3, center, center, 1);
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const orbitCount = o.orbitN ?? 12;
  const ghostCount = o.ghostN ?? 40;
  const particles = o.particles ?? 3;
  const dots: OrbDot[] = [];

  for (let orbit = 0; orbit < orbitCount; orbit++) {
    const h1 = hashD(orbit, 1.7);
    const h2 = hashD(orbit, 5.2);
    const h3 = hashD(orbit, 8.9);
    const orbitRadius = sphereRadius * (0.45 + 0.52 * h1);
    const theta = h1 * 2 * Math.PI;
    const phi = Math.acos(2 * h2 - 1);
    // Orbit plane basis: u and v perpendicular to the normal n.
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);
    const uLength = Math.max(1e-6, Math.hypot(ny, nx));
    const ux = -ny / uLength;
    const uy = nx / uLength;
    const uz = 0;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const angularSpeed = (0.25 + 0.55 * h3) * (h3 > 0.5 ? 1 : -1);
    const pointAt = (angle: number) =>
      project(
        (ux * Math.cos(angle) + vx * Math.sin(angle)) * orbitRadius,
        (uy * Math.cos(angle) + vy * Math.sin(angle)) * orbitRadius,
        (uz * Math.cos(angle) + vz * Math.sin(angle)) * orbitRadius,
      );

    for (let k = 0; k < ghostCount; k++) {
      const [x, y, z] = pointAt((k / ghostCount) * 2 * Math.PI);
      const depth = (z / orbitRadius + 1) / 2;
      dots.push({
        x,
        y,
        z,
        r: (o.ghostR ?? 0.9) * rs,
        white: 0.72,
        a: (o.ghostA ?? 0.5) * (0.4 + 0.6 * depth),
      });
    }
    for (let m = 0; m < particles; m++) {
      const [x, y, z] = pointAt(t * angularSpeed + (m / particles) * 2 * Math.PI + h2 * 6);
      const depth = (z / orbitRadius + 1) / 2;
      dots.push({
        x,
        y,
        z,
        r: ((o.partR ?? 1.2) + (o.partRDepth ?? 1.6) * depth) * rs,
        white: 0.3 - 0.22 * depth,
      });
    }
  }
  return finalizeFrame(dots, o.rMin);
};
