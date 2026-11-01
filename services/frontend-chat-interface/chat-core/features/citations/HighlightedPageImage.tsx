import type { BoundingBox } from '@chat-core/api/chatApiContract';

interface HighlightedPageImageProps {
  src: string;
  alt: string;
  /** Cited region in normalised (0–1) page coordinates. */
  highlight: BoundingBox | null;
}

const toPercent = (fraction: number) => `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(2)}%`;

/** A document page with the cited region outlined on top of it. */
export function HighlightedPageImage({ src, alt, highlight }: HighlightedPageImageProps) {
  return (
    <span className="relative block overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      <img src={src} alt={alt} className="block w-full" loading="lazy" />
      {highlight && (
        <span
          aria-hidden
          data-testid="citation-highlight"
          className="pointer-events-none absolute rounded-sm bg-accent/15 ring-2 ring-accent"
          style={{
            left: toPercent(highlight.x0),
            top: toPercent(highlight.y0),
            width: toPercent(highlight.x1 - highlight.x0),
            height: toPercent(highlight.y1 - highlight.y0),
          }}
        />
      )}
    </span>
  );
}
