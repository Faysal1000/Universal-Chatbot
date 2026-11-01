/** One dot of a frame, in a unit square centred on 0. `depth` runs from 0 (far) to 1 (near). */
export interface RibbonDot {
  x: number;
  y: number;
  depth: number;
  /** Where the dot sits on the colour gradient, 0 to 1 (wraps around). */
  colorPosition: number;
}

interface Ribbon {
  /** Tilt of the ribbon's ring about the x and z axes, in radians. */
  tiltX: number;
  tiltZ: number;
  /** Spin speed in radians per second; the sign sets the direction. */
  spin: number;
  phase: number;
}

/** Three tilted rings that weave through each other, each spinning its own way. */
const RIBBONS: readonly Ribbon[] = [
  { tiltX: 0.35, tiltZ: 0, spin: 0.55, phase: 0 },
  { tiltX: 1.25, tiltZ: 0.9, spin: -0.42, phase: 2.1 },
  { tiltX: 0.8, tiltZ: -1.1, spin: 0.33, phase: 4.2 },
];
const LANES = 4;
const SEGMENTS = 40;
const BAND_WIDTH = 0.42;
const FULL_TURN = Math.PI * 2;

/** The dots of every ribbon at `seconds`, sorted far to near so nearer dots paint over farther ones. */
export function ribbonOrbFrame(seconds: number): RibbonDot[] {
  const dots: RibbonDot[] = [];
  RIBBONS.forEach((ribbon, ribbonIndex) => {
    const spinAngle = seconds * ribbon.spin + ribbon.phase;
    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      const angle = (segment / SEGMENTS) * FULL_TURN;
      const wave = seconds + ribbon.phase;
      const radius = 0.78 + 0.1 * Math.sin(3 * angle + 1.7 * wave);
      const twist = 0.13 * Math.sin(2 * angle + 1.3 * wave) + 0.07 * Math.sin(3 * angle - 0.9 * wave);
      const width = BAND_WIDTH * (1 + 0.4 * Math.sin(2 * angle + wave));
      for (let lane = 0; lane < LANES; lane += 1) {
        const across = (lane / (LANES - 1) - 0.5) * width;
        const point = tilt(
          [Math.cos(angle + spinAngle) * radius, Math.sin(angle + spinAngle) * radius, across + twist],
          ribbon,
        );
        dots.push({
          x: point[0],
          y: point[1],
          depth: Math.min(1, Math.max(0, (point[2] + 1) / 2)),
          colorPosition: (segment / SEGMENTS + ribbonIndex / RIBBONS.length) % 1,
        });
      }
    }
  });
  return dots.sort((first, second) => first.depth - second.depth);
}

function tilt([x, y, z]: [number, number, number], { tiltX, tiltZ }: Ribbon): [number, number, number] {
  const tiltedY = y * Math.cos(tiltX) - z * Math.sin(tiltX);
  const tiltedZ = y * Math.sin(tiltX) + z * Math.cos(tiltX);
  return [
    x * Math.cos(tiltZ) - tiltedY * Math.sin(tiltZ),
    x * Math.sin(tiltZ) + tiltedY * Math.cos(tiltZ),
    tiltedZ,
  ];
}
