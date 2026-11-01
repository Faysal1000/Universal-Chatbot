/** `[1]`, `[2, 3]` or `[2,3]`: numbered references to the sources given to the model. */
const MARKER_GROUP_PATTERN = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;
/** A marker with the spaces before it, so hiding it leaves `days.` rather than `days .`. */
const MARKER_WITH_LEADING_SPACE_PATTERN = /[ \t]*\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g;
/** The end of a chunk that may still grow into a marker: trailing spaces, then `[`, `[1`, `[1,`… */
const POSSIBLE_MARKER_START_PATTERN = /[ \t]*(?:\[[\d\s,]{0,24})?$/;

/**
 * Source numbers the answer actually cites, in order of first appearance. Numbers outside
 * 1..sourceCount are invented by the model and ignored.
 */
export function extractCitedSourceNumbers(answerText: string, sourceCount: number): number[] {
  const citedNumbers: number[] = [];
  for (const match of answerText.matchAll(MARKER_GROUP_PATTERN)) {
    for (const numberText of (match[1] ?? '').split(',')) {
      const sourceNumber = Number(numberText.trim());
      const isKnownSource =
        Number.isInteger(sourceNumber) && sourceNumber >= 1 && sourceNumber <= sourceCount;
      if (isKnownSource && !citedNumbers.includes(sourceNumber)) citedNumbers.push(sourceNumber);
    }
  }
  return citedNumbers;
}

/** The answer as a visitor sees it when the admin hides sources. */
export function removeCitationMarkers(answerText: string): string {
  return answerText.replace(MARKER_WITH_LEADING_SPACE_PATTERN, '');
}

/**
 * Removes markers from an answer that arrives in chunks. A marker can be split across
 * chunks (`… days [` + `1].`), so a tail that may still become one is held back until the
 * next chunk or `flush()`.
 */
export class StreamingCitationMarkerRemover {
  private heldBack = '';

  /** The text that is safe to show now. */
  push(chunk: string): string {
    const pending = this.heldBack + chunk;
    const tailStart = POSSIBLE_MARKER_START_PATTERN.exec(pending)?.index ?? pending.length;
    this.heldBack = pending.slice(tailStart);
    return removeCitationMarkers(pending.slice(0, tailStart));
  }

  /** Whatever was held back once the answer has ended; an unfinished marker is plain text. */
  flush(): string {
    const remainder = removeCitationMarkers(this.heldBack);
    this.heldBack = '';
    return remainder;
  }
}
