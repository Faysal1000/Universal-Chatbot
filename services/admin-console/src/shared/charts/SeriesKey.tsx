/** Small colored square identifying a series. */
export function SeriesKey({ color }: { color: string }) {
  return (
    <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
  );
}
