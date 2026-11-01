import { describe, expect, it } from 'vitest';

import { TokenEstimator } from '../text/token-estimator.js';
import { assignSectionPaths, type DocumentBlock } from './document-blocks.js';
import { hashNormalisedText, StructureAwareChunker } from './structure-aware-chunker.js';

const FULL_PAGE = { x0: 0, y0: 0, x1: 1, y1: 1 };
let nextReadingOrder = 0;

function block(
  overrides: Partial<DocumentBlock> & Pick<DocumentBlock, 'blockType'>,
): Omit<DocumentBlock, 'sectionPath'> {
  nextReadingOrder += 1;
  return {
    id: `block-${nextReadingOrder}`,
    pageNumber: 1,
    readingOrder: nextReadingOrder,
    text: null,
    markdown: null,
    latex: null,
    headingLevel: null,
    bbox: FULL_PAGE,
    cropStorageKey: null,
    ...overrides,
  };
}

const heading = (text: string, headingLevel: number, pageNumber = 1) =>
  block({ blockType: 'heading', text, headingLevel, pageNumber });
const paragraph = (text: string, pageNumber = 1) => block({ blockType: 'paragraph', text, pageNumber });

function chunkDocument(
  blocks: Omit<DocumentBlock, 'sectionPath'>[],
  options = { targetTokens: 40, maximumTokens: 60 },
) {
  const chunker = new StructureAwareChunker(new TokenEstimator(1), options);
  return chunker.chunk('Staff Handbook', assignSectionPaths(blocks));
}

describe('assignSectionPaths', () => {
  it('nests subsections and starts a new branch at a shallower heading', () => {
    const blocks = assignSectionPaths([
      heading('1 Leave', 1),
      heading('1.1 Annual leave', 2),
      paragraph('Twenty days.'),
      heading('2 Pay', 1),
      paragraph('Monthly.'),
    ]);

    expect(blocks.map((assigned) => assigned.sectionPath)).toEqual([
      ['1 Leave'],
      ['1 Leave', '1.1 Annual leave'],
      ['1 Leave', '1.1 Annual leave'],
      ['2 Pay'],
      ['2 Pay'],
    ]);
  });

  it('keeps equal headings as siblings when a level is skipped below the title', () => {
    const blocks = assignSectionPaths([
      heading('Handbook', 1),
      heading('1 Leave', 3),
      heading('2 Remote work', 3),
    ]);

    expect(blocks.map((assigned) => assigned.sectionPath)).toEqual([
      ['Handbook'],
      ['Handbook', '1 Leave'],
      ['Handbook', '2 Remote work'],
    ]);
  });
});

describe('StructureAwareChunker', () => {
  it('never mixes sections and puts the section trail in the contextual header', () => {
    const chunks = chunkDocument([
      heading('Leave', 1),
      paragraph('Staff get twenty days of annual leave.'),
      heading('Pay', 1),
      paragraph('Salaries are paid monthly.'),
    ]);

    expect(chunks.map((chunk) => [chunk.contextualHeader, chunk.text])).toEqual([
      ['Staff Handbook › Leave', 'Staff get twenty days of annual leave.'],
      ['Staff Handbook › Pay', 'Salaries are paid monthly.'],
    ]);
  });

  it('packs paragraphs of one section until the target size, recording pages and blocks', () => {
    const sentence = 'Requests for leave must be approved by a line manager in advance.';
    const blocks = [paragraph(sentence, 1), paragraph(sentence, 2), paragraph(sentence, 2)];

    const chunks = chunkDocument(blocks, { targetTokens: 25, maximumTokens: 60 });

    expect(chunks.map((chunk) => chunk.blockIds)).toEqual([[blocks[0]?.id, blocks[1]?.id], [blocks[2]?.id]]);
    expect(chunks.map((chunk) => [chunk.pageStart, chunk.pageEnd])).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('splits an oversized paragraph at sentence boundaries without exceeding the ceiling', () => {
    const longParagraph = Array.from(
      { length: 30 },
      (_, index) => `Rule number ${index} applies to everyone.`,
    ).join(' ');

    const chunks = chunkDocument([paragraph(longParagraph)]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenCount <= 60)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join(' ')).toBe(longParagraph);
  });

  it('keeps a table whole with its caption, separate from running text', () => {
    const chunks = chunkDocument([
      paragraph('Prices are listed below.'),
      block({
        blockType: 'table',
        markdown: '| Plan | Price |\n| --- | --- |\n| Basic | $10 |',
        cropStorageKey: 'crops/t.png',
      }),
      block({ blockType: 'caption', text: 'Table 1: Plans' }),
      paragraph('Prices include tax.'),
    ]);

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'Prices are listed below.',
      'Table 1: Plans\n\n| Plan | Price |\n| --- | --- |\n| Basic | $10 |',
      'Prices include tax.',
    ]);
    expect(chunks[1]).toMatchObject({ chunkKind: 'text', cropStorageKey: 'crops/t.png' });
  });

  it('splits a long table into row groups that each repeat the header', () => {
    const rows = Array.from({ length: 40 }, (_, index) => `| Item ${index} | ${index * 3} taka |`);
    const tableMarkdown = ['| Item | Price |', '| --- | --- |', ...rows].join('\n');

    const chunks = chunkDocument([block({ blockType: 'table', markdown: tableMarkdown })]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.startsWith('| Item | Price |\n| --- | --- |\n'))).toBe(true);
  });

  it('turns a cropped chart into a visual chunk and drops page furniture', () => {
    const chunks = chunkDocument([
      block({ blockType: 'page_header', text: 'ACME Ltd — Confidential' }),
      block({ blockType: 'chart', text: 'Revenue grew 20% in 2025.', cropStorageKey: 'crops/c.png' }),
      block({ blockType: 'caption', text: 'Figure 2: Revenue' }),
      block({ blockType: 'page_footer', text: 'Page 3' }),
    ]);

    expect(chunks).toEqual([
      expect.objectContaining({
        chunkKind: 'visual',
        text: 'Figure 2: Revenue\n\nRevenue grew 20% in 2025.',
        cropStorageKey: 'crops/c.png',
      }),
    ]);
  });

  it('writes formulas as display LaTeX inside running text', () => {
    const chunks = chunkDocument([
      paragraph('The fee is'),
      block({ blockType: 'formula', latex: 'f = 0.02x' }),
    ]);

    expect(chunks[0]?.text).toBe('The fee is\n\n$$f = 0.02x$$');
  });

  it('chunks Bengali text by sections like any other language', () => {
    const chunks = chunkDocument([heading('ছুটির নিয়ম', 1), paragraph('কর্মীরা বছরে বিশ দিন ছুটি পান।')]);

    expect(chunks).toEqual([
      expect.objectContaining({
        contextualHeader: 'Staff Handbook › ছুটির নিয়ম',
        text: 'কর্মীরা বছরে বিশ দিন ছুটি পান।',
      }),
    ]);
  });
});

describe('hashNormalisedText', () => {
  it('ignores case and whitespace differences', () => {
    expect(hashNormalisedText('Refund  Policy\n')).toBe(hashNormalisedText('refund policy'));
  });
});
