import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../common/errors/application-error.js';
import { decodeKeysetCursor, toPage } from '../../common/pagination/keyset-cursor.js';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../ports/object-storage.port.js';
import { type AdminPrincipal, auditActorOf } from '../admin-auth/admin-principal.js';
import { AuditEventsRepository } from '../audit/audit-events.repository.js';
import { ChunksRepository } from '../index-versions/chunks.repository.js';
import { LiveIndexService } from '../index-versions/live-index.service.js';
import type { IngestionRunReference } from '../ingestion/ingestion-jobs.js';
import { IngestionPipelineService } from '../ingestion/ingestion-pipeline.service.js';
import { IngestionRunsRepository } from '../ingestion/ingestion-runs.repository.js';
import { ParsedContentRepository } from '../ingestion/parsed-content.repository.js';
import { documentPresenter } from './document-presenter.js';
import { documentStorageKeys } from './document-storage-keys.js';
import type {
  DocumentDetailView,
  DocumentListQuery,
  DocumentUpdate,
  DocumentView,
} from './documents-admin.schemas.js';
import { type DocumentRecord, DocumentsRepository } from './documents.repository.js';

const RUNS_SHOWN_IN_DETAIL = 10;

export interface AdminAction {
  readonly principal: AdminPrincipal;
  readonly requestId: string | undefined;
}

/** Admin use cases on documents other than upload: browse, toggle, rename, reprocess, delete. */
@Injectable()
export class DocumentsAdminService {
  constructor(
    private readonly documentsRepository: DocumentsRepository,
    private readonly ingestionRunsRepository: IngestionRunsRepository,
    private readonly parsedContentRepository: ParsedContentRepository,
    private readonly chunksRepository: ChunksRepository,
    private readonly liveIndex: LiveIndexService,
    private readonly ingestionPipeline: IngestionPipelineService,
    private readonly auditEventsRepository: AuditEventsRepository,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
  ) {}

  async list(query: DocumentListQuery): Promise<{ items: DocumentView[]; nextCursor: string | null }> {
    const rows = await this.documentsRepository.list({
      ...(query.ids === undefined ? {} : { ids: query.ids }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.isEnabled === undefined ? {} : { isEnabled: query.isEnabled }),
      ...(query.mimeType === undefined ? {} : { mimeType: query.mimeType }),
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.cursor === undefined ? {} : { before: decodeKeysetCursor(query.cursor) }),
      limit: query.limit + 1,
    });
    return toPage(rows, query.limit, documentPresenter.document, (document) => ({
      timestamp: document.createdAt,
      id: document.id,
    }));
  }

  async findOrFail(documentId: string): Promise<DocumentRecord> {
    const document = await this.documentsRepository.findById(documentId);
    if (document === undefined) {
      throw new ApplicationError(404, 'document_not_found', 'No document has this id.');
    }
    return document;
  }

  async describe(documentId: string): Promise<DocumentDetailView> {
    const document = await this.findOrFail(documentId);
    const [runs, pages, liveVersion] = await Promise.all([
      this.ingestionRunsRepository.listForDocument(documentId, RUNS_SHOWN_IN_DETAIL),
      this.parsedContentRepository.loadPages(documentId),
      this.liveIndex.findLiveVersion(),
    ]);
    const chunkCount =
      liveVersion === undefined
        ? 0
        : await this.chunksRepository.countDocumentChunks(documentId, liveVersion.id);
    return {
      ...documentPresenter.document(document),
      runs: runs.map(documentPresenter.ingestionRun),
      storage: {
        bucket: this.objectStorage.bucketName,
        originalObjectKey: document.storageKey,
        documentPrefix: documentStorageKeys.documentPrefix(documentId),
        indexVersionId: liveVersion?.id ?? null,
        chunkCount,
        pagesByKind: {
          digital: pages.filter((page) => page.pageKind === 'digital').length,
          scanned: pages.filter((page) => page.pageKind === 'scanned').length,
          hybrid: pages.filter((page) => page.pageKind === 'hybrid').length,
        },
      },
    };
  }

  async update(documentId: string, changes: DocumentUpdate, action: AdminAction): Promise<DocumentView> {
    const document = await this.findMutableOrFail(documentId);
    if (changes.isEnabled !== undefined && changes.isEnabled !== document.isEnabled) {
      await this.documentsRepository.update(documentId, { isEnabled: changes.isEnabled });
    }
    if (changes.title !== undefined) {
      await this.documentsRepository.update(documentId, { title: changes.title });
    }
    await this.audit(action, auditActionOf(changes), documentId, { ...changes });
    return documentPresenter.document(await this.findOrFail(documentId));
  }

  async reprocess(documentId: string, action: AdminAction): Promise<IngestionRunReference> {
    const document = await this.findMutableOrFail(documentId);
    const runReference = await this.ingestionPipeline.startRun(document, action.requestId);
    await this.audit(action, 'document.reprocessed', documentId, {
      ingestionRunId: runReference.ingestionRunId,
    });
    return runReference;
  }

  async delete(documentId: string, action: AdminAction): Promise<void> {
    const document = await this.findOrFail(documentId);
    if (document.status !== 'deleting') {
      await this.documentsRepository.update(documentId, { status: 'deleting', isEnabled: false });
      await this.audit(action, 'document.deleted', documentId, { fileName: document.originalFilename });
    }
    await this.ingestionPipeline.enqueueDeletion(documentId, action.requestId);
  }

  private async findMutableOrFail(documentId: string): Promise<DocumentRecord> {
    const document = await this.findOrFail(documentId);
    if (document.status === 'deleting') {
      throw new ApplicationError(409, 'document_being_deleted', 'The document is being deleted.');
    }
    return document;
  }

  private async audit(
    action: AdminAction,
    auditAction: string,
    documentId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.auditEventsRepository.record({
      actor: auditActorOf(action.principal),
      action: auditAction,
      targetType: 'document',
      targetId: documentId,
      details,
      ...(action.requestId === undefined ? {} : { requestId: action.requestId }),
    });
  }
}

function auditActionOf(changes: DocumentUpdate): string {
  if (changes.isEnabled === true) return 'document.enabled';
  if (changes.isEnabled === false) return 'document.disabled';
  return 'document.updated';
}
