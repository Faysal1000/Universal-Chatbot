import { Inject, Injectable } from '@nestjs/common';

import { StructureAwareChunker } from '../../domain/chunking/structure-aware-chunker.js';
import { toSearchDocument } from '../../domain/lexical/search-terms.js';
import { TokenEstimator } from '../../domain/text/token-estimator.js';
import {
  EMBEDDING_PORT,
  type DocumentEmbeddingInput,
  type EmbeddingPort,
} from '../../ports/embedding.port.js';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../ports/object-storage.port.js';
import { PermanentJobError } from '../../queue/permanent-job-error.js';
import type { DocumentRecord } from '../documents/documents.repository.js';
import { ChunkVectorsRepository } from '../index-versions/chunk-vectors.repository.js';
import { type ChunkRecord, ChunksRepository } from '../index-versions/chunks.repository.js';
import type { IndexVersionRecord } from '../index-versions/index-versions.repository.js';
import { LiveIndexService } from '../index-versions/live-index.service.js';
import { ParsedContentRepository } from './parsed-content.repository.js';

/** Chunks embedded per round, so progress moves and memory stays flat. */
const CHUNKS_PER_ROUND = 64;
/** The embedding server rejects images above 5 MiB; such crops are embedded as text only. */
const MAXIMUM_EMBEDDED_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Writes one ingestion run of a document into one index version: its chunks, then each
 * chunk's embedding and search terms. Used by ingestion (live version) and by index
 * builds (a new or older version).
 */
@Injectable()
export class DocumentIndexer {
  private readonly chunker: StructureAwareChunker;

  constructor(
    tokenEstimator: TokenEstimator,
    private readonly parsedContentRepository: ParsedContentRepository,
    private readonly chunksRepository: ChunksRepository,
    private readonly chunkVectorsRepository: ChunkVectorsRepository,
    private readonly liveIndex: LiveIndexService,
    @Inject(EMBEDDING_PORT) private readonly embeddingPort: EmbeddingPort,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
  ) {
    this.chunker = new StructureAwareChunker(tokenEstimator);
  }

  /** Chunks the run's stored blocks for `indexVersion`, replacing earlier chunks of the run there. */
  async chunkRun(
    document: DocumentRecord,
    ingestionRunId: string,
    indexVersion: IndexVersionRecord,
  ): Promise<ChunkRecord[]> {
    const blocks = await this.parsedContentRepository.loadRunBlocks(ingestionRunId);
    const chunkDrafts = this.chunker.chunk(document.title ?? document.originalFilename, blocks);
    if (chunkDrafts.length === 0) {
      throw new PermanentJobError(
        'no_extractable_content',
        'The document contains no text, tables or figures to index.',
      );
    }
    return this.chunksRepository.replaceRunChunks(
      ingestionRunId,
      indexVersion.id,
      chunkDrafts.map((draft) => ({
        documentId: document.id,
        indexVersionId: indexVersion.id,
        ingestionRunId,
        chunkKind: draft.chunkKind,
        text: draft.text,
        contextualHeader: draft.contextualHeader,
        pageStart: draft.pageStart,
        pageEnd: draft.pageEnd,
        blockIds: [...draft.blockIds],
        cropStorageKey: draft.cropStorageKey,
        tokenCount: draft.tokenCount,
        contentHash: draft.contentHash,
      })),
    );
  }

  /**
   * Embeds the chunks round by round. `onRound` reports how many are done and returns
   * false to stop, for example when the run was cancelled or its document deleted.
   */
  async embedChunks(
    document: DocumentRecord,
    chunkRecords: readonly ChunkRecord[],
    indexVersion: IndexVersionRecord,
    onRound?: (indexedChunks: number) => Promise<boolean>,
  ): Promise<void> {
    for (let offset = 0; offset < chunkRecords.length; offset += CHUNKS_PER_ROUND) {
      const roundChunks = chunkRecords.slice(offset, offset + CHUNKS_PER_ROUND);
      const embedding = await this.embeddingPort.embedDocuments(
        await this.toEmbeddingInputs(document, roundChunks),
      );
      this.liveIndex.assertCompatible(indexVersion, embedding.modelIdentity);
      await this.chunkVectorsRepository.upsert(
        roundChunks.map((chunk, index) => ({
          chunkId: chunk.id,
          indexVersionId: indexVersion.id,
          embedding: embedding.vectors[index] ?? [],
          searchTerms: toSearchDocument(embeddingTextOf(chunk)),
        })),
      );
      if ((await onRound?.(offset + roundChunks.length)) === false) return;
    }
  }

  private async toEmbeddingInputs(
    document: DocumentRecord,
    roundChunks: readonly ChunkRecord[],
  ): Promise<DocumentEmbeddingInput[]> {
    const title = document.title ?? document.originalFilename;
    return Promise.all(
      roundChunks.map(async (chunk): Promise<DocumentEmbeddingInput> => {
        const text = embeddingTextOf(chunk);
        const imageBase64 =
          chunk.chunkKind === 'visual' ? await this.readCropBase64(chunk.cropStorageKey) : undefined;
        return imageBase64 === undefined
          ? { kind: 'text', text, title }
          : { kind: 'text_image', text, imageBase64, title };
      }),
    );
  }

  private async readCropBase64(cropStorageKey: string | null): Promise<string | undefined> {
    if (cropStorageKey === null) return undefined;
    const imageBytes = await this.objectStorage.readBytes(cropStorageKey);
    return imageBytes.length <= MAXIMUM_EMBEDDED_IMAGE_BYTES ? imageBytes.toString('base64') : undefined;
  }
}

/** The section trail gives short chunks the context they lack on their own. */
function embeddingTextOf(chunk: Pick<ChunkRecord, 'contextualHeader' | 'text'>): string {
  return `${chunk.contextualHeader}\n\n${chunk.text}`;
}
