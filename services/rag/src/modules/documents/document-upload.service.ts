import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { ApplicationError } from '../../common/errors/application-error.js';
import { receiveMultipartFile, type ReceivedFile } from '../../common/http/multipart-file-receiver.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { isUniqueViolation } from '../../database/database-errors.js';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../ports/object-storage.port.js';
import { type AdminPrincipal, actingAdminUserId, auditActorOf } from '../admin-auth/admin-principal.js';
import { AuditEventsRepository } from '../audit/audit-events.repository.js';
import { IngestionPipelineService } from '../ingestion/ingestion-pipeline.service.js';
import { detectDocumentContentType } from './document-content-type.js';
import { documentStorageKeys } from './document-storage-keys.js';
import { type DocumentRecord, DocumentsRepository } from './documents.repository.js';

const FILE_FIELD_NAME = 'file';
const TITLE_FIELD_NAME = 'title';
const MAXIMUM_TITLE_LENGTH = 300;

export interface DocumentUploadRequest {
  readonly request: Request;
  readonly principal: AdminPrincipal;
  readonly requestId: string | undefined;
}

/**
 * Accepts an admin upload: streams it to a staging object while hashing it, rejects
 * duplicates and unsupported types, moves it to its content-addressed key and starts
 * an ingestion run.
 */
@Injectable()
export class DocumentUploadService {
  constructor(
    private readonly documentsRepository: DocumentsRepository,
    private readonly ingestionPipeline: IngestionPipelineService,
    private readonly auditEventsRepository: AuditEventsRepository,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async upload({ request, principal, requestId }: DocumentUploadRequest): Promise<DocumentRecord> {
    const stagingKey = documentStorageKeys.staging(randomUUID());
    try {
      const form = await receiveMultipartFile(request, {
        fileFieldName: FILE_FIELD_NAME,
        maximumFileBytes: this.configuration.ingestion.maxUploadBytes,
        storeFile: (fileStream) =>
          this.objectStorage.uploadStream(stagingKey, fileStream, 'application/octet-stream'),
      });
      const title = parseTitle(form.textFields[TITLE_FIELD_NAME]);
      const document = await this.storeDocument(form.file, title, stagingKey, principal);
      await this.auditEventsRepository.record({
        actor: auditActorOf(principal),
        action: 'document.uploaded',
        targetType: 'document',
        targetId: document.id,
        details: { fileName: document.originalFilename, byteSize: document.byteSize },
        ...(requestId === undefined ? {} : { requestId }),
      });
      await this.ingestionPipeline.startRun(document, requestId);
      return document;
    } finally {
      await this.objectStorage.deleteObject(stagingKey);
    }
  }

  private async storeDocument(
    file: ReceivedFile,
    title: string | null,
    stagingKey: string,
    principal: AdminPrincipal,
  ): Promise<DocumentRecord> {
    const mimeType = await detectDocumentContentType(file.headBytes);
    await this.rejectDuplicate(file.sha256);
    const storageKey = documentStorageKeys.original(file.sha256);
    await this.objectStorage.copyObject(stagingKey, storageKey);
    try {
      return await this.documentsRepository.insert({
        sha256: file.sha256,
        originalFilename: sanitiseFileName(file.fileName),
        mimeType,
        byteSize: file.byteSize,
        title,
        storageKey,
        uploadedByAdminUserId: actingAdminUserId(principal),
      });
    } catch (error: unknown) {
      // A concurrent upload of the same bytes won the race; its row owns the original.
      if (isUniqueViolation(error)) await this.rejectDuplicate(file.sha256);
      throw error;
    }
  }

  private async rejectDuplicate(sha256: string): Promise<void> {
    const existingDocument = await this.documentsRepository.findBySha256(sha256);
    if (existingDocument === undefined) return;
    throw new ApplicationError(409, 'duplicate_document', 'This file has already been uploaded.', {
      details: { existingDocumentId: existingDocument.id },
    });
  }
}

function parseTitle(titleField: string | undefined): string | null {
  const title = titleField?.trim() ?? '';
  if (title === '') return null;
  if (title.length > MAXIMUM_TITLE_LENGTH) {
    throw new ApplicationError(422, 'validation_failed', 'The request is invalid.', {
      fieldErrors: [{ field: TITLE_FIELD_NAME, message: `At most ${MAXIMUM_TITLE_LENGTH} characters.` }],
    });
  }
  return title;
}

/** Keeps only the base name, without control characters, for display and downloads. */
function sanitiseFileName(fileName: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const baseName = path.basename(fileName.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '');
  return baseName.slice(0, 255) || 'document';
}
