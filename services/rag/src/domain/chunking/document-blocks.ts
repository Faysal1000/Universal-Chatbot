import type { BlockType } from '../../database/schema.js';

export interface NormalisedBoundingBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A parsed block in document order, as stored in the `blocks` table. */
export interface DocumentBlock {
  readonly id: string;
  readonly pageNumber: number;
  readonly readingOrder: number;
  readonly blockType: BlockType;
  readonly text: string | null;
  readonly markdown: string | null;
  readonly latex: string | null;
  readonly headingLevel: number | null;
  readonly bbox: NormalisedBoundingBox;
  readonly cropStorageKey: string | null;
  readonly sectionPath: readonly string[];
}

const MAXIMUM_SECTION_DEPTH = 6;
const DEFAULT_HEADING_LEVEL = 2;
const MAXIMUM_HEADING_CHARACTERS = 200;

/**
 * Assigns every block the trail of headings above it. A heading closes every open
 * heading of the same or a deeper level, so "2.1" after "2" nests, a later "3" starts a
 * new branch, and skipped levels (a level-3 heading right under the title) still make
 * siblings of equal headings. Page furniture never changes the trail.
 */
export function assignSectionPaths<Block extends Omit<DocumentBlock, 'sectionPath'>>(
  blocksInDocumentOrder: readonly Block[],
): (Block & { sectionPath: string[] })[] {
  let openHeadings: { readonly level: number; readonly text: string }[] = [];
  return blocksInDocumentOrder.map((block) => {
    const headingText = block.blockType === 'heading' ? cleanHeadingText(block.text) : undefined;
    if (headingText !== undefined) {
      const level = Math.min(block.headingLevel ?? DEFAULT_HEADING_LEVEL, MAXIMUM_SECTION_DEPTH);
      openHeadings = [
        ...openHeadings.filter((heading) => heading.level < level),
        { level, text: headingText },
      ];
    }
    return { ...block, sectionPath: openHeadings.map((heading) => heading.text) };
  });
}

function cleanHeadingText(text: string | null): string | undefined {
  const collapsed = text
    ?.replace(/\s+/g, ' ')
    .replace(/^#+\s*/, '')
    .trim();
  return collapsed === undefined || collapsed === ''
    ? undefined
    : collapsed.slice(0, MAXIMUM_HEADING_CHARACTERS);
}
