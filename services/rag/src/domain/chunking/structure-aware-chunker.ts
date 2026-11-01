import { createHash } from 'node:crypto';

import type { ChunkKind } from '../../database/schema.js';
import type { TokenEstimator } from '../text/token-estimator.js';
import type { DocumentBlock } from './document-blocks.js';

export const CHUNKER_VERSION = 'structure-aware-v1';

export interface ChunkingOptions {
  /** A text chunk is closed once it reaches this many tokens. */
  readonly targetTokens: number;
  /** Hard ceiling; longer paragraphs and tables are split. */
  readonly maximumTokens: number;
}

const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = { targetTokens: 350, maximumTokens: 600 };

export interface ChunkDraft {
  readonly chunkKind: ChunkKind;
  /** Body shown to the model and in citations. */
  readonly text: string;
  /** "Title › Section › Subsection", prepended when embedding. */
  readonly contextualHeader: string;
  readonly pageStart: number;
  readonly pageEnd: number;
  readonly blockIds: readonly string[];
  readonly cropStorageKey: string | null;
  readonly tokenCount: number;
  readonly contentHash: string;
}

const PAGE_FURNITURE: ReadonlySet<string> = new Set(['page_header', 'page_footer']);
const SENTENCE_BOUNDARY = /(?<=[.!?।])\s+/u;

/**
 * Splits a document into retrieval chunks along its structure:
 * - a chunk never crosses a section boundary, so its header describes all of it;
 * - running text (paragraphs, lists, formulas) is packed up to the target size;
 * - each table is its own chunk (split by rows with the header repeated when too long);
 * - figures and charts with a crop become visual chunks, carrying their caption;
 * - page headers and footers are dropped.
 */
export class StructureAwareChunker {
  constructor(
    private readonly tokenEstimator: TokenEstimator,
    private readonly options: ChunkingOptions = DEFAULT_CHUNKING_OPTIONS,
  ) {}

  chunk(documentTitle: string, blocksInDocumentOrder: readonly DocumentBlock[]): ChunkDraft[] {
    const builder = new ChunkListBuilder(documentTitle, this.tokenEstimator, this.options);
    const contentBlocks = blocksInDocumentOrder.filter((block) => !PAGE_FURNITURE.has(block.blockType));
    contentBlocks.forEach((block, index) => {
      this.addBlock(builder, block, contentBlocks[index + 1]);
    });
    builder.flushText();
    return builder.chunks;
  }

  private addBlock(
    builder: ChunkListBuilder,
    block: DocumentBlock,
    nextBlock: DocumentBlock | undefined,
  ): void {
    switch (block.blockType) {
      case 'heading':
        builder.startSection(block.sectionPath);
        return;
      case 'table':
        builder.addTable(block, captionFollowing(block, nextBlock));
        return;
      case 'figure':
      case 'chart':
        builder.addVisual(block, captionFollowing(block, nextBlock));
        return;
      case 'caption':
        if (!builder.wasCaptionConsumed(block.id)) builder.addRunningText(block, block.text);
        return;
      case 'formula':
        builder.addRunningText(block, block.latex === null ? block.text : `$$${block.latex}$$`);
        return;
      default:
        builder.addRunningText(block, block.markdown ?? block.text);
    }
  }
}

/** A caption directly after a table or figure on the same page belongs to it. */
function captionFollowing(
  block: DocumentBlock,
  nextBlock: DocumentBlock | undefined,
): DocumentBlock | undefined {
  return nextBlock?.blockType === 'caption' && nextBlock.pageNumber === block.pageNumber
    ? nextBlock
    : undefined;
}

interface PendingText {
  readonly sectionPath: readonly string[];
  readonly parts: string[];
  readonly blocks: DocumentBlock[];
  tokenCount: number;
}

class ChunkListBuilder {
  readonly chunks: ChunkDraft[] = [];
  private pending: PendingText | undefined;
  private readonly consumedCaptionIds = new Set<string>();

  constructor(
    private readonly documentTitle: string,
    private readonly tokenEstimator: TokenEstimator,
    private readonly options: ChunkingOptions,
  ) {}

  startSection(sectionPath: readonly string[]): void {
    if (this.pending !== undefined && !sameSection(this.pending.sectionPath, sectionPath)) this.flushText();
  }

  wasCaptionConsumed(blockId: string): boolean {
    return this.consumedCaptionIds.has(blockId);
  }

  addRunningText(block: DocumentBlock, rawText: string | null): void {
    const text = rawText?.trim();
    if (text === undefined || text === '') return;
    for (const piece of this.splitOversizedText(text)) this.appendPiece(block, piece);
  }

  addTable(block: DocumentBlock, caption: DocumentBlock | undefined): void {
    const tableText = (block.markdown ?? block.text)?.trim();
    if (tableText === undefined || tableText === '') return;
    this.flushText();
    const captionText = this.consumeCaption(caption);
    const sourceBlocks = caption === undefined ? [block] : [block, caption];
    for (const tablePart of this.splitTableByRows(tableText)) {
      const text = captionText === undefined ? tablePart : `${captionText}\n\n${tablePart}`;
      this.pushChunk('text', text, block.sectionPath, sourceBlocks, block.cropStorageKey);
    }
  }

  addVisual(block: DocumentBlock, caption: DocumentBlock | undefined): void {
    const captionText = this.consumeCaption(caption);
    const description = block.text?.trim();
    const text = [captionText, description].filter((part) => part !== undefined && part !== '').join('\n\n');
    const sourceBlocks = caption === undefined ? [block] : [block, caption];
    this.flushText();
    if (block.cropStorageKey !== null) {
      // An uncaptioned figure still gets a textual stand-in so lexical search has something.
      const visualText = text === '' ? block.blockType : text;
      this.pushChunk('visual', visualText, block.sectionPath, sourceBlocks, block.cropStorageKey);
    } else if (text !== '') {
      this.pushChunk('text', text, block.sectionPath, sourceBlocks, null);
    }
  }

  flushText(): void {
    if (this.pending === undefined) return;
    const { sectionPath, parts, blocks } = this.pending;
    this.pending = undefined;
    this.pushChunk('text', parts.join('\n\n'), sectionPath, blocks, null);
  }

  private appendPiece(block: DocumentBlock, piece: string): void {
    const pieceTokens = this.tokenEstimator.estimate(piece);
    const pending = this.pending;
    const fitsPending =
      pending !== undefined &&
      sameSection(pending.sectionPath, block.sectionPath) &&
      pending.tokenCount + pieceTokens <= this.options.maximumTokens;
    if (!fitsPending) {
      this.flushText();
      this.pending = {
        sectionPath: block.sectionPath,
        parts: [piece],
        blocks: [block],
        tokenCount: pieceTokens,
      };
    } else {
      pending.parts.push(piece);
      if (!pending.blocks.includes(block)) pending.blocks.push(block);
      pending.tokenCount += pieceTokens;
    }
    if (this.pending !== undefined && this.pending.tokenCount >= this.options.targetTokens) this.flushText();
  }

  private consumeCaption(caption: DocumentBlock | undefined): string | undefined {
    if (caption === undefined) return undefined;
    this.consumedCaptionIds.add(caption.id);
    return caption.text?.trim();
  }

  /** Splits text longer than the ceiling at sentence boundaries, then hard-cuts what remains. */
  private splitOversizedText(text: string): string[] {
    if (this.tokenEstimator.estimate(text) <= this.options.maximumTokens) return [text];
    const pieces: string[] = [];
    let current = '';
    for (const sentence of text.split(SENTENCE_BOUNDARY)) {
      const candidate = current === '' ? sentence : `${current} ${sentence}`;
      if (this.tokenEstimator.estimate(candidate) <= this.options.targetTokens) {
        current = candidate;
        continue;
      }
      if (current !== '') pieces.push(current);
      current = sentence;
      while (this.tokenEstimator.estimate(current) > this.options.maximumTokens) {
        const head = this.tokenEstimator.truncate(current, this.options.targetTokens);
        if (head === '') break;
        pieces.push(head);
        current = current.slice(head.length).trim();
      }
    }
    if (current !== '') pieces.push(current);
    return pieces;
  }

  /** Markdown tables are split into row groups that each repeat the header and separator. */
  private splitTableByRows(tableText: string): string[] {
    if (this.tokenEstimator.estimate(tableText) <= this.options.maximumTokens) return [tableText];
    const lines = tableText.split('\n');
    const hasMarkdownHeader = lines.length > 2 && /^\s*\|?\s*:?-{3,}/.test(lines[1] ?? '');
    const header = hasMarkdownHeader ? lines.slice(0, 2) : [];
    const rows = hasMarkdownHeader ? lines.slice(2) : lines;
    const parts: string[] = [];
    let currentRows: string[] = [];
    for (const row of rows) {
      const candidate = [...header, ...currentRows, row].join('\n');
      if (currentRows.length > 0 && this.tokenEstimator.estimate(candidate) > this.options.targetTokens) {
        parts.push([...header, ...currentRows].join('\n'));
        currentRows = [];
      }
      currentRows.push(row);
    }
    if (currentRows.length > 0) parts.push([...header, ...currentRows].join('\n'));
    return parts;
  }

  private pushChunk(
    chunkKind: ChunkKind,
    text: string,
    sectionPath: readonly string[],
    sourceBlocks: readonly DocumentBlock[],
    cropStorageKey: string | null,
  ): void {
    const pageNumbers = sourceBlocks.map((block) => block.pageNumber);
    this.chunks.push({
      chunkKind,
      text,
      contextualHeader: [this.documentTitle, ...sectionPath].join(' › '),
      pageStart: Math.min(...pageNumbers),
      pageEnd: Math.max(...pageNumbers),
      blockIds: sourceBlocks.map((block) => block.id),
      cropStorageKey,
      tokenCount: this.tokenEstimator.estimate(text),
      contentHash: hashNormalisedText(text),
    });
  }
}

function sameSection(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((heading, index) => heading === second[index]);
}

/** Whitespace and case differences do not make content different. */
export function hashNormalisedText(text: string): string {
  const normalisedText = text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256').update(normalisedText).digest('hex');
}
