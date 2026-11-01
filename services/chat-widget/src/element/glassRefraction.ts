/** Referenced by the launcher's `backdrop-filter` in launcher.css. */
export const GLASS_REFRACTION_FILTER_ID = 'ucb-glass-refraction';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MAP_SIZE = 96;
/** Share of the radius, from the centre, that stays flat; only the rim bends what is behind it. */
const FLAT_CENTRE = 0.55;
/** Largest shift of the backdrop at the very rim, in CSS pixels (the map's ±127 is half of `scale`). */
const MAX_SHIFT_PX = 7;
const NEUTRAL = 128;

/**
 * A displacement map for a round lens: neutral grey in the centre, and towards the rim the red and green
 * channels point inwards, so `feDisplacementMap` pulls the backdrop in from the edge the way a thick glass
 * bead does. Red shifts horizontally, green vertically.
 */
export function lensDisplacementMap(size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = ((column + 0.5) / size) * 2 - 1;
      const y = ((row + 0.5) / size) * 2 - 1;
      const distance = Math.hypot(x, y);
      const rim = Math.min(1, Math.max(0, (distance - FLAT_CENTRE) / (1 - FLAT_CENTRE)));
      const strength = distance === 0 ? 0 : (127 * rim * rim) / distance;
      const offset = (row * size + column) * 4;
      pixels[offset] = NEUTRAL - strength * x;
      pixels[offset + 1] = NEUTRAL - strength * y;
      pixels[offset + 2] = NEUTRAL;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Adds the SVG filter that bends the page at the launcher's rim, Apple's "liquid glass" lensing. Only
 * Chromium applies an SVG filter as a backdrop filter; elsewhere the launcher keeps its frosted glass.
 * Returns whether the filter was added.
 */
export function addGlassRefraction(shadow: ShadowRoot): boolean {
  if (!isChromium()) return false;
  const mapUrl = displacementMapUrl();
  if (mapUrl === null) return false;

  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  setAttributes(svg, { width: '0', height: '0', 'aria-hidden': 'true', style: 'position:absolute' });
  const filter = document.createElementNS(SVG_NAMESPACE, 'filter');
  setAttributes(filter, {
    id: GLASS_REFRACTION_FILTER_ID,
    x: '0',
    y: '0',
    width: '100%',
    height: '100%',
    'color-interpolation-filters': 'sRGB',
  });
  const map = document.createElementNS(SVG_NAMESPACE, 'feImage');
  setAttributes(map, {
    href: mapUrl,
    x: '0',
    y: '0',
    width: '100%',
    height: '100%',
    preserveAspectRatio: 'none',
    result: 'lens',
  });
  const displacement = document.createElementNS(SVG_NAMESPACE, 'feDisplacementMap');
  setAttributes(displacement, {
    in: 'SourceGraphic',
    in2: 'lens',
    scale: String(MAX_SHIFT_PX * 2),
    xChannelSelector: 'R',
    yChannelSelector: 'G',
  });
  filter.append(map, displacement);
  svg.append(filter);
  shadow.append(svg);
  return true;
}

function isChromium(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData
    ?.brands;
  return brands?.some(({ brand }) => brand === 'Chromium') ?? false;
}

function displacementMapUrl(): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(MAP_SIZE, MAP_SIZE);
  image.data.set(lensDisplacementMap(MAP_SIZE));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

function setAttributes(element: Element, attributes: Record<string, string>): void {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
}
