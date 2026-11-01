// Adapted from thinking-orbs by Jakub Antalik (https://github.com/Jakubantalik/thinking-orbs, commit de85557),
// MIT licensed — see ../LICENSE. Changes: strict TypeScript, typed options, only the states this app uses.
//
// "shaping": a dotted outline cycling circle → triangle → square. Each shape is a closed path parameterised by
// arc length; every frame blends two neighbouring paths and lays the dots evenly along the blended outline.

import { finalizeFrame } from '../orbGeometry';
import type { OrbDot, OrbModeFrame } from '../orbTypes';

type ShapePath = (fraction: number) => [number, number];
type Point = readonly [number, number];

const smoothStep = (x: number) => x * x * (3 - 2 * x);

function polygonPath(vertices: readonly Point[]): ShapePath {
  const edges = vertices.map((start, i) => {
    const end = vertices[(i + 1) % vertices.length] ?? start;
    return { start, end, length: Math.hypot(end[0] - start[0], end[1] - start[1]) };
  });
  const total = edges.reduce((sum, edge) => sum + edge.length, 0);
  return (fraction) => {
    let remaining = fraction * total;
    let index = 0;
    while (index < edges.length - 1 && remaining > (edges[index]?.length ?? 0)) {
      remaining -= edges[index]?.length ?? 0;
      index++;
    }
    const edge = edges[index] ?? edges[0];
    if (!edge) return [0, 0];
    const f = edge.length ? Math.min(1, remaining / edge.length) : 0;
    return [
      edge.start[0] + (edge.end[0] - edge.start[0]) * f,
      edge.start[1] + (edge.end[1] - edge.start[1]) * f,
    ];
  };
}

const CIRCLE: ShapePath = (fraction) => {
  const angle = -Math.PI / 2 + fraction * 2 * Math.PI;
  return [Math.cos(angle) * 0.24, Math.sin(angle) * 0.24];
};
const TRIANGLE = polygonPath([
  [0, -0.26],
  [0.24, 0.16],
  [-0.24, 0.16],
]);
// Five vertices so the walk starts at top-centre like the other shapes.
const SQUARE = polygonPath([
  [0, -0.2],
  [0.2, -0.2],
  [0.2, 0.2],
  [-0.2, 0.2],
  [-0.2, -0.2],
]);
const SHAPE_CYCLE: readonly ShapePath[] = [CIRCLE, TRIANGLE, SQUARE];

const HOLD_SECONDS = 1.4;
const MORPH_SECONDS = 0.9;
const SEGMENT_SECONDS = HOLD_SECONDS + MORPH_SECONDS;
const OUTLINE_SAMPLES = 160;

export const frameMorph: OrbModeFrame = (size, t, o) => {
  const shapeCount = SHAPE_CYCLE.length;
  const cycleTime = t % (SEGMENT_SECONDS * shapeCount);
  const shapeIndex = Math.floor(cycleTime / SEGMENT_SECONDS);
  const local = cycleTime - shapeIndex * SEGMENT_SECONDS;
  const blend = local > HOLD_SECONDS ? smoothStep((local - HOLD_SECONDS) / MORPH_SECONDS) : 0;
  const spread = o.spread ?? 1;
  const from = SHAPE_CYCLE[shapeIndex] ?? CIRCLE;
  const to = SHAPE_CYCLE[(shapeIndex + 1) % shapeCount] ?? CIRCLE;

  const outline: Point[] = Array.from({ length: OUTLINE_SAMPLES }, (_, i) => {
    const a = from(i / OUTLINE_SAMPLES);
    const b = to(i / OUTLINE_SAMPLES);
    return [(a[0] + (b[0] - a[0]) * blend) * spread, (a[1] + (b[1] - a[1]) * blend) * spread];
  });
  const segmentLengths = outline.map((point, i) => {
    const next = outline[(i + 1) % OUTLINE_SAMPLES] ?? point;
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  });
  const total = segmentLengths.reduce((sum, length) => sum + length, 0);

  // Radius depends only on rDot; the count sets the gaps. Formed shapes breathe slightly.
  const dotCount = Math.max(6, Math.round(34 * (o.iconD ?? 1)));
  const dotRadius = Math.max(0.35, (o.rDot ?? 0.021) * 1.35 * spread * size);
  const pulse = 1 + 0.02 * Math.sin(local * 3.1);
  const center = size / 2;
  const dots: OrbDot[] = [];
  let segment = 0;
  let travelled = 0;

  for (let k = 0; k < dotCount; k++) {
    const target = (k / dotCount) * total;
    while (segment < OUTLINE_SAMPLES - 1 && travelled + (segmentLengths[segment] ?? 0) < target) {
      travelled += segmentLengths[segment] ?? 0;
      segment++;
    }
    const a = outline[segment] ?? [0, 0];
    const b = outline[(segment + 1) % OUTLINE_SAMPLES] ?? a;
    const length = segmentLengths[segment] ?? 0;
    const f = length ? Math.min(1, (target - travelled) / length) : 0;
    dots.push({
      x: center + (a[0] + (b[0] - a[0]) * f) * pulse * size,
      y: center + (a[1] + (b[1] - a[1]) * f) * pulse * size,
      z: 0,
      r: dotRadius,
      white: 0.1,
    });
  }
  return finalizeFrame(dots, o.rMin);
};
