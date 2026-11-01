import { describe, expect, it } from 'vitest';

import type { EmbeddingModelIdentity } from '../../../ports/embedding.port.js';
import type { QueueProducerService } from '../../../queue/queue-producer.service.js';
import type { AdminPrincipal } from '../../admin-auth/admin-principal.js';
import type { AuditEventsRepository } from '../../audit/audit-events.repository.js';
import type { ChunksRepository } from '../chunks.repository.js';
import type { IndexVersionRecord, IndexVersionsRepository } from '../index-versions.repository.js';
import type { LiveIndexService } from '../live-index.service.js';
import { IndexVersionsAdminService } from './index-versions-admin.service.js';

const action = { principal: { kind: 'api_key' } as unknown as AdminPrincipal, requestId: undefined };
const gemma: EmbeddingModelIdentity = { model: 'embeddinggemma-2', modelRevision: 'abc', dimension: 768 };

function retiredVersion(overrides: Partial<IndexVersionRecord> = {}): IndexVersionRecord {
  return {
    id: 1,
    status: 'retired',
    embeddingModel: gemma.model,
    embeddingModelRevision: gemma.modelRevision,
    embeddingDimension: gemma.dimension,
    ...overrides,
  } as IndexVersionRecord;
}

function adminService(version: IndexVersionRecord, missingDocumentCount: number, servedModel = gemma) {
  const madeLive: number[] = [];
  const service = new IndexVersionsAdminService(
    {
      findById: () => Promise.resolve(version),
      promote: (indexVersionId: number) => {
        madeLive.push(indexVersionId);
        return Promise.resolve();
      },
    } as unknown as IndexVersionsRepository,
    {
      countDocumentsMissingFromVersion: () => Promise.resolve(missingDocumentCount),
    } as unknown as ChunksRepository,
    { currentEmbeddingModel: () => Promise.resolve(servedModel) } as unknown as LiveIndexService,
    { enqueue: () => Promise.resolve('job') } as unknown as QueueProducerService,
    { record: () => Promise.resolve() } as unknown as AuditEventsRepository,
  );
  return { service, madeLive };
}

describe('IndexVersionsAdminService.promote', () => {
  it('rolls back to a complete retired version of the current model', async () => {
    const { service, madeLive } = adminService(retiredVersion(), 0);

    const summary = await service.promote(1, action);

    expect(summary.indexVersion.status).toBe('live');
    expect(madeLive).toEqual([1]);
  });

  it('refuses a version that misses ready documents', async () => {
    const { service, madeLive } = adminService(retiredVersion(), 3);

    await expect(service.promote(1, action)).rejects.toMatchObject({
      httpStatus: 409,
      code: 'index_version_incomplete',
    });
    expect(madeLive).toEqual([]);
  });

  it('refuses a version built with another embedding model', async () => {
    const { service } = adminService(retiredVersion(), 0, { ...gemma, model: 'other-embedder' });

    await expect(service.promote(1, action)).rejects.toMatchObject({ code: 'embedding_model_mismatch' });
  });

  it('refuses a version that is still building', async () => {
    const { service } = adminService(retiredVersion({ status: 'building' }), 0);

    await expect(service.promote(1, action)).rejects.toMatchObject({ code: 'index_version_not_promotable' });
  });
});
