export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

const DARK_INK = '#111111';
const LIGHT_INK = '#ffffff';

/** Reads the `rgb(…)` / `rgba(…)` string browsers report as a computed colour. */
export function parseComputedRgb(value: string): RgbColor | null {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value.trim());
  if (!match) return null;
  return { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]) };
}

/** WCAG relative luminance (0 = black, 1 = white). */
function relativeLuminance({ red, green, blue }: RgbColor): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

export function contrastRatio(first: RgbColor, second: RgbColor): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Text colour for labels on the brand colour: whichever of near-black and white contrasts more. */
export function inkForBrandColor(brand: RgbColor): string {
  const white = { red: 255, green: 255, blue: 255 };
  const nearBlack = { red: 17, green: 17, blue: 17 };
  return contrastRatio(brand, white) >= contrastRatio(brand, nearBlack) ? LIGHT_INK : DARK_INK;
}

/**
 * Resolves any CSS colour (`#0a7`, `teal`, `oklch(…)`) through the browser, so the widget accepts what a site
 * already uses in its own CSS. Returns null for something that is not a colour.
 */
export function resolveCssColor(value: string, probeParent: Element): RgbColor | null {
  if (!CSS.supports('color', value)) return null;
  const probe = document.createElement('span');
  probe.style.color = value;
  probe.style.display = 'none';
  probeParent.append(probe);
  const resolved = parseComputedRgb(getComputedStyle(probe).color);
  probe.remove();
  return resolved;
}
