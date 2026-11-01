import { Inject, Injectable } from '@nestjs/common';

import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../../ports/object-storage.port.js';
import { documentStorageKeys } from '../../documents/document-storage-keys.js';
import { DocumentsRepository } from '../../documents/documents.repository.js';
import { QueueProducerService } from '../../../queue/queue-producer.service.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { ingestionJobIds } from '../ingestion-jobs.js';

/** A page batch the parser is already working on can still write files after the first pass. */
const LATE_FILE_SWEEP_DELAY_MILLISECONDS = 15 * 60_000;

/**
 * Removes a document everywhere: stored files, the original upload, then the rows
 * (blocks, chunks, their vectors and runs cascade).
 * Each step tolerates a previous partial attempt, so the job can be retried safely.
 */
@Injectable()
export class DeleteDocumentService {
  constructor(
    private readonly documentsRepository: DocumentsRepository,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
    private readonly queueProducer: QueueProducerService,
  ) {}

  async delete(documentId: string): Promise<void> {
    const document = await this.documentsRepository.findById(documentId);
    if (document === undefined) {
      await this.objectStorage.deletePrefix(documentStorageKeys.documentPrefix(documentId));
      return;
    }
    await this.objectStorage.deletePrefix(documentStorageKeys.documentPrefix(documentId));
    await this.objectStorage.deleteObject(document.storageKey);
    await this.documentsRepository.delete(documentId);
    await this.queueProducer.enqueue(
      QUEUE_NAMES.documentDelete,
      'delete',
      { documentId },
      {
        jobId: `${ingestionJobIds.deleteDocument(documentId)}.late-files`,
        overrides: { delay: LATE_FILE_SWEEP_DELAY_MILLISECONDS },
      },
    );
  }
}
