import { ribbonOrbFrame } from './ribbonOrbGeometry';

const MAX_DEVICE_PIXEL_RATIO = 2;
/** Time of the single frame shown to reduced-motion visitors. */
const STATIC_FRAME_SECONDS = 1.2;
/** Cyan → blue → violet → magenta and back, so the colours flow round each ribbon without a seam. */
const GRADIENT_STOPS: readonly [number, number, number][] = [
  [34, 211, 238],
  [59, 130, 246],
  [139, 92, 246],
  [232, 121, 249],
  [34, 211, 238],
];
const FIRST_STOP: [number, number, number] = [34, 211, 238];
const GRADIENT_STEPS = 48;

function buildGradient(): string[] {
  return Array.from({ length: GRADIENT_STEPS }, (_, step) => {
    const position = (step / GRADIENT_STEPS) * (GRADIENT_STOPS.length - 1);
    const index = Math.floor(position);
    const mix = position - index;
    const [fromRed, fromGreen, fromBlue] = GRADIENT_STOPS[index] ?? FIRST_STOP;
    const [toRed, toGreen, toBlue] = GRADIENT_STOPS[index + 1] ?? FIRST_STOP;
    const blend = (from: number, to: number) => Math.round(from + (to - from) * mix);
    return `rgb(${blend(fromRed, toRed)} ${blend(fromGreen, toGreen)} ${blend(fromBlue, toBlue)})`;
  });
}

const GRADIENT = buildGradient();

/**
 * The launcher's orb: dotted ribbons woven round a sphere, drawn on a canvas `size` CSS pixels wide.
 * The stylesheet may show the canvas smaller (the pill) or at full size (the collapsed round button).
 */
export class RibbonOrb {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly pixelRatio = Math.min(MAX_DEVICE_PIXEL_RATIO, window.devicePixelRatio || 1);
  private animationFrame = 0;
  private isPlaying = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly size: number,
  ) {
    canvas.width = Math.round(size * this.pixelRatio);
    canvas.height = Math.round(size * this.pixelRatio);
    this.context = canvas.getContext('2d');
  }

  play(): void {
    if (this.isPlaying) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.drawAt(STATIC_FRAME_SECONDS);
      return;
    }
    this.isPlaying = true;
    const loop = () => {
      this.drawAt(performance.now() / 1000);
      if (this.isPlaying) this.animationFrame = requestAnimationFrame(loop);
    };
    this.animationFrame = requestAnimationFrame(loop);
  }

  pause(): void {
    this.isPlaying = false;
    cancelAnimationFrame(this.animationFrame);
  }

  dispose(): void {
    this.pause();
  }

  private drawAt(seconds: number): void {
    const context = this.context;
    if (!context) return;
    const half = this.size / 2;
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.size, this.size);
    for (const dot of ribbonOrbFrame(seconds)) {
      context.globalAlpha = 0.3 + 0.7 * dot.depth;
      context.fillStyle = GRADIENT[Math.floor(dot.colorPosition * GRADIENT_STEPS)] ?? 'rgb(34 211 238)';
      context.beginPath();
      context.arc(
        half + dot.x * half * 0.94,
        half + dot.y * half * 0.94,
        this.size * (0.009 + 0.013 * dot.depth),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.globalAlpha = 1;
  }
}
