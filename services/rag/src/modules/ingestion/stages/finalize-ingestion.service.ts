import { Inject, Injectable } from '@nestjs/common';

import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../../ports/object-storage.port.js';
import { documentStorageKeys } from '../../documents/document-storage-keys.js';
import { DocumentsRepository } from '../../documents/documents.repository.js';
import { ChunksRepository } from '../../index-versions/chunks.repository.js';
import type { IngestionRunReference } from '../ingestion-jobs.js';
import { IngestionRunsRepository } from '../ingestion-runs.repository.js';
import { ParsedContentRepository } from '../parsed-content.repository.js';

/**
 * Makes the run's index entries the document's only ones: removes chunks (and with them
 * their vectors), blocks and stored files of earlier runs, and marks the document ready.
 */
@Injectable()
export class FinalizeIngestionService {
  constructor(
    private readonly chunksRepository: ChunksRepository,
    private readonly parsedContentRepository: ParsedContentRepository,
    private readonly ingestionRunsRepository: IngestionRunsRepository,
    private readonly documentsRepository: DocumentsRepository,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
  ) {}

  async finalize(runReference: IngestionRunReference): Promise<void> {
    if (!(await this.ingestionRunsRepository.isActive(runReference.ingestionRunId))) return;
    const document = await this.documentsRepository.findById(runReference.documentId);
    if (document === undefined) return;
    const { documentId, ingestionRunId } = runReference;
    await this.chunksRepository.deleteChunksOfOtherRuns(documentId, ingestionRunId);
    await this.parsedContentRepository.deleteBlocksOfOtherRuns(documentId, ingestionRunId);
    await this.deleteFilesOfEarlierRuns(documentId, ingestionRunId);
    if (!(await this.ingestionRunsRepository.markSucceeded(ingestionRunId))) return;
    await this.documentsRepository.update(documentId, {
      status: 'ready',
      failureCode: null,
      failureMessage: null,
    });
  }

  private async deleteFilesOfEarlierRuns(documentId: string, currentIngestionRunId: string): Promise<void> {
    const earlierRuns = await this.ingestionRunsRepository.listForDocument(documentId, 1_000);
    for (const run of earlierRuns) {
      if (run.id === currentIngestionRunId || run.status === 'queued' || run.status === 'running') continue;
      await this.objectStorage.deletePrefix(documentStorageKeys.runPrefix(documentId, run.id));
    }
  }
}
