import { Injectable } from '@nestjs/common';

import { extractCitedSourceNumbers } from '../../../domain/chat/citation-markers.js';
import { ParsedContentRepository } from '../../ingestion/parsed-content.repository.js';
import type { RetrievedSource } from '../../retrieval/retrieval.service.js';
import {
  type MessageCitationRecord,
  MessageCitationsRepository,
  type NewMessageCitationRecord,
} from '../persistence/message-citations.repository.js';
import type { CitationView } from './turn-stream-events.js';

const SNIPPET_LENGTH = 280;

/**
 * Turns the `[n]` markers of a finished answer into stored citations. Only sources the
 * answer really cites are kept, each with its page, a snippet and where on the page it
 * is, snapshotted so history survives re-indexing.
 */
@Injectable()
export class CitationAssembler {
  constructor(
    private readonly parsedContentRepository: ParsedContentRepository,
    private readonly messageCitationsRepository: MessageCitationsRepository,
  ) {}

  async storeCitations(
    assistantMessageId: string,
    answerText: string,
    sources: readonly RetrievedSource[],
  ): Promise<CitationView[]> {
    const citedNumbers = extractCitedSourceNumbers(answerText, sources.length);
    const citations = await Promise.all(
      citedNumbers.map(async (sourceNumber) => {
        const source = sources[sourceNumber - 1];
        return source === undefined
          ? undefined
          : this.describeCitation(assistantMessageId, sourceNumber, source);
      }),
    );
    const stored = await this.messageCitationsRepository.insertMany(
      citations.filter((citation): citation is NewMessageCitationRecord => citation !== undefined),
    );
    return stored.map(presentCitation);
  }

  private async describeCitation(
    messageId: string,
    marker: number,
    source: RetrievedSource,
  ): Promise<NewMessageCitationRecord> {
    const { chunk } = source;
    const [blocks, page] = await Promise.all([
      this.parsedContentRepository.loadBlocksByIds(chunk.blockIds),
      this.parsedContentRepository.findPage(chunk.documentId, chunk.pageStart),
    ]);
    const firstPageBlocks = blocks.filter((block) => block.pageNumber === chunk.pageStart);
    return {
      messageId,
      marker,
      chunkKind: chunk.chunkKind,
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      pageNumber: chunk.pageStart,
      snippet: snippetOf(chunk.text),
      ...boundingBoxOf(firstPageBlocks),
      cropStorageKey: chunk.cropStorageKey,
      pageRenderStorageKey: page?.renderStorageKey ?? null,
    };
  }
}

export function presentCitation(citation: MessageCitationRecord): CitationView {
  const hasBoundingBox =
    citation.bboxX0 !== null &&
    citation.bboxY0 !== null &&
    citation.bboxX1 !== null &&
    citation.bboxY1 !== null;
  return {
    id: citation.id,
    marker: citation.marker,
    kind: citation.chunkKind,
    documentId: citation.documentId ?? '',
    documentTitle: citation.documentTitle,
    page: citation.pageNumber,
    snippet: citation.snippet,
    bbox: hasBoundingBox
      ? {
          x0: citation.bboxX0 ?? 0,
          y0: citation.bboxY0 ?? 0,
          x1: citation.bboxX1 ?? 0,
          y1: citation.bboxY1 ?? 0,
        }
      : null,
    hasPreview: citation.pageRenderStorageKey !== null || citation.cropStorageKey !== null,
  };
}

/** The box enclosing the cited blocks on the first cited page. */
function boundingBoxOf(
  blocks: readonly { bboxX0: number; bboxY0: number; bboxX1: number; bboxY1: number }[],
): Pick<NewMessageCitationRecord, 'bboxX0' | 'bboxY0' | 'bboxX1' | 'bboxY1'> {
  if (blocks.length === 0) return { bboxX0: null, bboxY0: null, bboxX1: null, bboxY1: null };
  return {
    bboxX0: Math.min(...blocks.map((block) => block.bboxX0)),
    bboxY0: Math.min(...blocks.map((block) => block.bboxY0)),
    bboxX1: Math.max(...blocks.map((block) => block.bboxX1)),
    bboxY1: Math.max(...blocks.map((block) => block.bboxY1)),
  };
}

function snippetOf(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length <= SNIPPET_LENGTH
    ? singleLine
    : `${singleLine.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`;
}
