import { Injectable, Logger } from '@nestjs/common';

import { PermanentJobError } from '../../../queue/permanent-job-error.js';
import { DocumentsRepository } from '../../documents/documents.repository.js';
import { DocumentIndexer } from '../../ingestion/document-indexer.service.js';
import { ChunksRepository, type MissingDocument } from '../chunks.repository.js';
import { type IndexVersionRecord, IndexVersionsRepository } from '../index-versions.repository.js';

/** Documents fetched per catch-up round. */
const DOCUMENTS_PER_ROUND = 20;
/** Stops a build that keeps finding the same document missing (it would fail every round). */
const MAXIMUM_ROUNDS = 10_000;

/**
 * Brings an index version up to date: every ready document whose current run is not in
 * the version is chunked from its stored blocks (no re-parsing) and embedded.
 * The same pass builds a new version, resumes an interrupted build, and catches an older
 * version up before a rollback.
 */
@Injectable()
export class IndexBuildService {
  private readonly logger = new Logger(IndexBuildService.name);

  constructor(
    private readonly indexVersionsRepository: IndexVersionsRepository,
    private readonly chunksRepository: ChunksRepository,
    private readonly documentsRepository: DocumentsRepository,
    private readonly documentIndexer: DocumentIndexer,
  ) {}

  async build(indexVersionId: number): Promise<{ indexedDocuments: number }> {
    const indexVersion = await this.findBuildableOrFail(indexVersionId);
    let indexedDocuments = 0;
    for (let round = 0; round < MAXIMUM_ROUNDS; round += 1) {
      const missingDocuments = await this.chunksRepository.findDocumentsMissingFromVersion(
        indexVersionId,
        DOCUMENTS_PER_ROUND,
      );
      if (missingDocuments.length === 0) break;
      for (const missingDocument of missingDocuments) {
        if (await this.indexDocument(indexVersion, missingDocument)) indexedDocuments += 1;
      }
    }
    if (indexVersion.status === 'building') await this.indexVersionsRepository.markReady(indexVersionId);
    this.logger.log(`Index version ${indexVersionId} is up to date (${indexedDocuments} documents indexed)`);
    return { indexedDocuments };
  }

  /** A version that failed to build is rebuilt by creating a new one. */
  async markFailedIfBuilding(indexVersionId: number): Promise<void> {
    const indexVersion = await this.indexVersionsRepository.findById(indexVersionId);
    if (indexVersion?.status === 'building') await this.indexVersionsRepository.markFailed(indexVersionId);
  }

  private async findBuildableOrFail(indexVersionId: number): Promise<IndexVersionRecord> {
    const indexVersion = await this.indexVersionsRepository.findById(indexVersionId);
    if (indexVersion === undefined || indexVersion.status === 'failed') {
      throw new PermanentJobError(
        'index_version_not_buildable',
        `Index version ${indexVersionId} cannot be built.`,
      );
    }
    return indexVersion;
  }

  /** Returns false when the document changed meanwhile; the next round sees its new state. */
  private async indexDocument(indexVersion: IndexVersionRecord, missing: MissingDocument): Promise<boolean> {
    const document = await this.documentsRepository.findById(missing.documentId);
    if (document?.status !== 'ready') return false;
    const chunkRecords = await this.documentIndexer.chunkRun(document, missing.ingestionRunId, indexVersion);
    await this.documentIndexer.embedChunks(document, chunkRecords, indexVersion);
    return true;
  }
}
