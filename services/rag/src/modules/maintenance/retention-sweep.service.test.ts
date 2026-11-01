import { describe, expect, it } from 'vitest';

import { validTestEnvironment } from '../../../test/support/test-environment.js';
import { parseConfiguration } from '../../config/configuration.js';
import type { ObjectStoragePort } from '../../ports/object-storage.port.js';
import type { ChatAttachmentsRepository } from '../chat/persistence/chat-attachments.repository.js';
import type { RetrievalTracesRepository } from '../chat/persistence/retrieval-traces.repository.js';
import type { VisitorSessionsRepository } from '../public-access/visitor-sessions.repository.js';
import { RetentionSweepService } from './retention-sweep.service.js';

const NOW = new Date('2026-10-30T12:00:00Z');

interface SweepScenario {
  readonly unboundKeys?: string[];
  readonly expiredSessionKeys?: string[];
  readonly failingKeys?: string[];
}

function sweepScenario({ unboundKeys = [], expiredSessionKeys = [], failingKeys = [] }: SweepScenario) {
  const deletedKeys: string[] = [];
  const cutoffs: { sessions?: Date; traces?: Date } = {};
  const attachments = {
    listExpired: () => Promise.resolve(unboundKeys.map((storageKey) => ({ id: storageKey, storageKey }))),
    deleteByIds: () => Promise.resolve(),
    listStorageKeysOfSessionsExpiredBefore: () => Promise.resolve(expiredSessionKeys),
  } as unknown as ChatAttachmentsRepository;
  const sessions = {
    deleteExpiredBefore: (cutoff: Date) => {
      cutoffs.sessions = cutoff;
      return Promise.resolve(2);
    },
  } as unknown as VisitorSessionsRepository;
  const traces = {
    deleteOlderThan: (cutoff: Date) => {
      cutoffs.traces = cutoff;
      return Promise.resolve(7);
    },
  } as unknown as RetrievalTracesRepository;
  const objectStorage = {
    deleteObject: (key: string) => {
      if (failingKeys.includes(key)) return Promise.reject(new Error('storage unavailable'));
      deletedKeys.push(key);
      return Promise.resolve();
    },
  } as unknown as ObjectStoragePort;
  const configuration = parseConfiguration(
    validTestEnvironment({ RAG_VISITOR_DATA_RETENTION_DAYS: '90', RAG_RETRIEVAL_TRACE_RETENTION_DAYS: '30' }),
  );
  const service = new RetentionSweepService(attachments, sessions, traces, objectStorage, configuration);
  return { service, deletedKeys, cutoffs };
}

describe('RetentionSweepService', () => {
  it('deletes unsent images, long-expired sessions with their images, and old traces', async () => {
    const { service, deletedKeys, cutoffs } = sweepScenario({
      unboundKeys: ['attachments/a'],
      expiredSessionKeys: ['attachments/b', 'attachments/c'],
    });

    const result = await service.sweep(NOW);

    expect(result).toEqual({
      unboundAttachmentsDeleted: 1,
      visitorSessionsDeleted: 2,
      retrievalTracesDeleted: 7,
      objectDeletionFailures: 0,
    });
    expect(deletedKeys).toEqual(['attachments/a', 'attachments/b', 'attachments/c']);
    expect(cutoffs.sessions?.toISOString()).toBe('2026-08-01T12:00:00.000Z');
    expect(cutoffs.traces?.toISOString()).toBe('2026-09-30T12:00:00.000Z');
  });

  it('keeps the sessions for the next sweep when one of their images cannot be deleted', async () => {
    const { service, cutoffs } = sweepScenario({
      expiredSessionKeys: ['attachments/b', 'attachments/c'],
      failingKeys: ['attachments/c'],
    });

    const result = await service.sweep(NOW);

    expect(result.visitorSessionsDeleted).toBe(0);
    expect(result.objectDeletionFailures).toBe(1);
    expect(cutoffs.sessions).toBeUndefined();
  });
});
