import { Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../common/errors/application-error.js';
import { QueueProducerService } from '../../../queue/queue-producer.service.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { auditActorOf } from '../../admin-auth/admin-principal.js';
import { AuditEventsRepository } from '../../audit/audit-events.repository.js';
import type { AdminAction } from '../../documents/documents-admin.service.js';
import { indexBuildJobId, type IndexBuildPayload } from '../build/index-build-jobs.js';
import { ChunksRepository } from '../chunks.repository.js';
import { type IndexVersionRecord, IndexVersionsRepository } from '../index-versions.repository.js';
import { LiveIndexService, usesEmbeddingModel } from '../live-index.service.js';

export interface IndexVersionSummary {
  readonly indexVersion: IndexVersionRecord;
  /** Ready documents not yet in this version; a version is promotable only at zero. */
  readonly missingDocumentCount: number;
}

/**
 * Index versions for admins: build a new one (new chunker or embedding model), catch an
 * older one up, promote one to live (which is also how a rollback works) and delete
 * versions that are no longer needed.
 */
@Injectable()
export class IndexVersionsAdminService {
  constructor(
    private readonly indexVersionsRepository: IndexVersionsRepository,
    private readonly chunksRepository: ChunksRepository,
    private readonly liveIndex: LiveIndexService,
    private readonly queueProducer: QueueProducerService,
    private readonly auditEventsRepository: AuditEventsRepository,
  ) {}

  async list(): Promise<IndexVersionSummary[]> {
    const indexVersions = await this.indexVersionsRepository.list();
    return Promise.all(indexVersions.map((indexVersion) => this.summarise(indexVersion)));
  }

  async create(action: AdminAction): Promise<IndexVersionSummary> {
    const indexVersions = await this.indexVersionsRepository.list();
    if (indexVersions.some((indexVersion) => indexVersion.status === 'building')) {
      throw new ApplicationError(
        409,
        'index_build_in_progress',
        'Another index version is still being built.',
      );
    }
    const indexVersion = await this.liveIndex.createBuildingVersion();
    await this.enqueueBuild(indexVersion.id, action);
    await this.audit(action, 'index_version.created', indexVersion.id, {
      embeddingModel: indexVersion.embeddingModel,
      chunkerVersion: indexVersion.chunkerVersion,
    });
    return this.summarise(indexVersion);
  }

  /** Builds a new version further, or catches an older one up with documents added since. */
  async build(indexVersionId: number, action: AdminAction): Promise<IndexVersionSummary> {
    const indexVersion = await this.findOrFail(indexVersionId);
    if (indexVersion.status === 'failed') {
      throw new ApplicationError(
        409,
        'index_version_failed',
        'A failed version cannot be built; create a new one.',
      );
    }
    await this.enqueueBuild(indexVersionId, action);
    return this.summarise(indexVersion);
  }

  async promote(indexVersionId: number, action: AdminAction): Promise<IndexVersionSummary> {
    const indexVersion = await this.findOrFail(indexVersionId);
    if (indexVersion.status !== 'ready' && indexVersion.status !== 'retired') {
      throw new ApplicationError(
        409,
        'index_version_not_promotable',
        `A ${indexVersion.status} version cannot be promoted.`,
      );
    }
    await this.assertComplete(indexVersion);
    await this.assertServedByCurrentModel(indexVersion);
    await this.indexVersionsRepository.promote(indexVersionId);
    // Documents that finished ingestion during the checks went to the previous version.
    await this.enqueueBuild(indexVersionId, action);
    await this.audit(action, 'index_version.promoted', indexVersionId, {});
    return this.summarise({ ...indexVersion, status: 'live' });
  }

  async delete(indexVersionId: number, action: AdminAction): Promise<void> {
    const indexVersion = await this.findOrFail(indexVersionId);
    if (indexVersion.status === 'live' || indexVersion.status === 'building') {
      throw new ApplicationError(
        409,
        'index_version_in_use',
        `A ${indexVersion.status} version cannot be deleted.`,
      );
    }
    await this.indexVersionsRepository.delete(indexVersionId);
    await this.audit(action, 'index_version.deleted', indexVersionId, {});
  }

  private async summarise(indexVersion: IndexVersionRecord): Promise<IndexVersionSummary> {
    const missingDocumentCount =
      indexVersion.status === 'failed'
        ? 0
        : await this.chunksRepository.countDocumentsMissingFromVersion(indexVersion.id);
    return { indexVersion, missingDocumentCount };
  }

  private async assertComplete(indexVersion: IndexVersionRecord): Promise<void> {
    const missingDocumentCount = await this.chunksRepository.countDocumentsMissingFromVersion(
      indexVersion.id,
    );
    if (missingDocumentCount > 0) {
      throw new ApplicationError(
        409,
        'index_version_incomplete',
        `${missingDocumentCount} ready documents are not in this version yet. Build it first.`,
        { details: { missingDocumentCount } },
      );
    }
  }

  /** Questions are embedded with the current model, so the version must hold its vectors. */
  private async assertServedByCurrentModel(indexVersion: IndexVersionRecord): Promise<void> {
    const currentModel = await this.liveIndex.currentEmbeddingModel();
    if (!usesEmbeddingModel(indexVersion, currentModel)) {
      throw new ApplicationError(
        409,
        'embedding_model_mismatch',
        `This version holds ${indexVersion.embeddingModel} vectors but the embedding server serves ${currentModel.model}.`,
      );
    }
  }

  private async findOrFail(indexVersionId: number): Promise<IndexVersionRecord> {
    const indexVersion = await this.indexVersionsRepository.findById(indexVersionId);
    if (indexVersion === undefined) {
      throw new ApplicationError(404, 'index_version_not_found', 'No index version has this id.');
    }
    return indexVersion;
  }

  private async enqueueBuild(indexVersionId: number, action: AdminAction): Promise<void> {
    const payload: IndexBuildPayload = { indexVersionId };
    await this.queueProducer.enqueue(QUEUE_NAMES.indexRebuild, 'build', payload, {
      jobId: indexBuildJobId(indexVersionId, new Date()),
      ...(action.requestId === undefined ? {} : { requestId: action.requestId }),
    });
  }

  private async audit(
    action: AdminAction,
    auditAction: string,
    indexVersionId: number,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.auditEventsRepository.record({
      actor: auditActorOf(action.principal),
      action: auditAction,
      targetType: 'index_version',
      targetId: String(indexVersionId),
      details,
      ...(action.requestId === undefined ? {} : { requestId: action.requestId }),
    });
  }
}
