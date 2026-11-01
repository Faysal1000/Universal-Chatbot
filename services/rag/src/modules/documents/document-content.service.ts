import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../common/errors/application-error.js';
import {
  OBJECT_STORAGE_PORT,
  type ObjectStoragePort,
  type StoredObjectStream,
} from '../../ports/object-storage.port.js';
import { ChunksRepository } from '../index-versions/chunks.repository.js';
import { LiveIndexService } from '../index-versions/live-index.service.js';
import { type DocumentPageRecord, ParsedContentRepository } from '../ingestion/parsed-content.repository.js';
import { documentPresenter } from './document-presenter.js';
import type { BlockView, ChunkView, DocumentPageView } from './documents-admin.schemas.js';
import { DocumentsAdminService } from './documents-admin.service.js';

export interface DownloadableFile extends StoredObjectStream {
  readonly fileName: string;
}

/** Read access to what ingestion produced: pages, blocks, chunks and the stored files. */
@Injectable()
export class DocumentContentService {
  constructor(
    private readonly documentsAdmin: DocumentsAdminService,
    private readonly parsedContentRepository: ParsedContentRepository,
    private readonly chunksRepository: ChunksRepository,
    private readonly liveIndex: LiveIndexService,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
  ) {}

  async listPages(documentId: string): Promise<DocumentPageView[]> {
    await this.documentsAdmin.findOrFail(documentId);
    const pages = await this.parsedContentRepository.loadPages(documentId);
    return pages.map(documentPresenter.page);
  }

  async describePage(
    documentId: string,
    pageNumber: number,
  ): Promise<DocumentPageView & { blocks: BlockView[] }> {
    const page = await this.findPageOrFail(documentId, pageNumber);
    const blocks = await this.parsedContentRepository.loadPageBlocks(page);
    return { ...documentPresenter.page(page), blocks: blocks.map(documentPresenter.block) };
  }

  async listChunks(
    documentId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: ChunkView[]; total: number; indexVersionId: number | null }> {
    await this.documentsAdmin.findOrFail(documentId);
    const liveVersion = await this.liveIndex.findLiveVersion();
    if (liveVersion === undefined) return { items: [], total: 0, indexVersionId: null };
    const [chunks, total] = await Promise.all([
      this.chunksRepository.loadDocumentChunks(documentId, liveVersion.id, limit, offset),
      this.chunksRepository.countDocumentChunks(documentId, liveVersion.id),
    ]);
    return { items: chunks.map(documentPresenter.chunk), total, indexVersionId: liveVersion.id };
  }

  async openOriginal(documentId: string): Promise<DownloadableFile> {
    const document = await this.documentsAdmin.findOrFail(documentId);
    const storedFile = await this.objectStorage.openReadStream(document.storageKey);
    return { ...storedFile, contentType: document.mimeType, fileName: document.originalFilename };
  }

  async openPageImage(documentId: string, pageNumber: number): Promise<StoredObjectStream> {
    const page = await this.findPageOrFail(documentId, pageNumber);
    if (page.renderStorageKey === null) throw noImageError('This page has no rendered image.');
    return this.objectStorage.openReadStream(page.renderStorageKey);
  }

  async openBlockCrop(documentId: string, blockId: string): Promise<StoredObjectStream> {
    const block = await this.parsedContentRepository.findBlock(documentId, blockId);
    if (block?.cropStorageKey === null || block?.cropStorageKey === undefined) {
      throw noImageError('This block has no cropped image.');
    }
    return this.objectStorage.openReadStream(block.cropStorageKey);
  }

  private async findPageOrFail(documentId: string, pageNumber: number): Promise<DocumentPageRecord> {
    await this.documentsAdmin.findOrFail(documentId);
    const page = await this.parsedContentRepository.findPage(documentId, pageNumber);
    if (page === undefined) {
      throw new ApplicationError(404, 'page_not_found', 'The document has no such page.');
    }
    return page;
  }
}

function noImageError(message: string): ApplicationError {
  return new ApplicationError(404, 'image_not_found', message);
}
