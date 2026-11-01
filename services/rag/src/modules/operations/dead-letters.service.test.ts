import { describe, expect, it } from 'vitest';

import type { DeadLetterRecord } from '../../queue/dead-letter-record.js';
import { createJobEnvelope } from '../../queue/job-envelope.js';
import type { QueueAdministrationService } from '../../queue/queue-administration.service.js';
import type { QueueProducerService } from '../../queue/queue-producer.service.js';
import type { AdminPrincipal } from '../admin-auth/admin-principal.js';
import type { AuditEventsRepository } from '../audit/audit-events.repository.js';
import type { DocumentsAdminService } from '../documents/documents-admin.service.js';
import { DeadLettersService } from './dead-letters.service.js';

const DOCUMENT_ID = '7c0a3f52-4a0e-4b8e-9a51-2d6f0e1c9b11';
const RUN_ID = '0d9b6b8e-6f55-4f3c-8a7e-5b2a1f4c3d22';
const action = { principal: { kind: 'api_key' } as unknown as AdminPrincipal, requestId: 'request-1' };

function deadLetter(overrides: Partial<DeadLetterRecord>): DeadLetterRecord {
  return {
    originalQueueName: 'ingest.chunk',
    originalJobId: `${DOCUMENT_ID}.${RUN_ID}.chunk`,
    originalJobName: 'chunk',
    payload: createJobEnvelope({ documentId: DOCUMENT_ID, ingestionRunId: RUN_ID }),
    failureCode: 'job_failed',
    failureMessage: 'boom',
    failedAt: '2026-10-30T10:00:00.000Z',
    attemptsMade: 5,
    ...overrides,
  };
}

function deadLettersHolding(
  record: DeadLetterRecord | undefined,
  options: { failedJobStillStored?: boolean } = {},
) {
  const calls = {
    reprocessed: [] as string[],
    retried: [] as string[],
    enqueued: [] as string[],
    discarded: [] as string[],
  };
  const queueAdministration = {
    findDeadLetter: (id: string) => Promise.resolve(record === undefined ? undefined : { id, record }),
    discardDeadLetter: (id: string) => {
      calls.discarded.push(id);
      return Promise.resolve(true);
    },
    retryFailedJob: (queueName: string, jobId: string) => {
      calls.retried.push(`${queueName}/${jobId}`);
      return Promise.resolve(options.failedJobStillStored ?? true);
    },
  } as unknown as QueueAdministrationService;
  const queueProducer = {
    enqueue: (queueName: string, _jobName: string, _payload: unknown, enqueueOptions: { jobId: string }) => {
      calls.enqueued.push(`${queueName}/${enqueueOptions.jobId}`);
      return Promise.resolve(enqueueOptions.jobId);
    },
  } as unknown as QueueProducerService;
  const documentsAdmin = {
    reprocess: (documentId: string) => {
      calls.reprocessed.push(documentId);
      return Promise.resolve({ documentId, ingestionRunId: 'new-run' });
    },
  } as unknown as DocumentsAdminService;
  const audit = { record: () => Promise.resolve() } as unknown as AuditEventsRepository;
  return {
    service: new DeadLettersService(queueAdministration, queueProducer, documentsAdmin, audit),
    calls,
  };
}

describe('DeadLettersService.retry', () => {
  it('starts a new run of the document for a failed ingestion job', async () => {
    const { service, calls } = deadLettersHolding(deadLetter({}));

    const outcome = await service.retry('dead-1', action);

    expect(outcome).toEqual({
      action: 'document_reprocessed',
      documentId: DOCUMENT_ID,
      ingestionRunId: 'new-run',
    });
    expect(calls.retried).toEqual([]);
    expect(calls.discarded).toEqual(['dead-1']);
  });

  it('moves any other failed job back to its queue', async () => {
    const { service, calls } = deadLettersHolding(
      deadLetter({ originalQueueName: 'document.delete', originalJobId: `${DOCUMENT_ID}.delete` }),
    );

    const outcome = await service.retry('dead-2', action);

    expect(outcome).toEqual({
      action: 'job_retried',
      queueName: 'document.delete',
      jobId: `${DOCUMENT_ID}.delete`,
    });
    expect(calls.retried).toEqual([`document.delete/${DOCUMENT_ID}.delete`]);
    expect(calls.enqueued).toEqual([]);
  });

  it('adds the job again under its id when the failed job was already cleaned up', async () => {
    const { service, calls } = deadLettersHolding(
      deadLetter({ originalQueueName: 'chat.summarise', originalJobId: 'conversation.42' }),
      { failedJobStillStored: false },
    );

    await service.retry('dead-3', action);

    expect(calls.enqueued).toEqual(['chat.summarise/conversation.42']);
  });

  it('refuses a dead letter from an unknown queue', async () => {
    const { service, calls } = deadLettersHolding(deadLetter({ originalQueueName: 'legacy.queue' }));

    await expect(service.retry('dead-4', action)).rejects.toMatchObject({
      httpStatus: 409,
      code: 'dead_letter_not_retryable',
    });
    expect(calls.discarded).toEqual([]);
  });

  it('answers 404 for an unknown dead letter', async () => {
    const { service } = deadLettersHolding(undefined);

    await expect(service.retry('missing', action)).rejects.toMatchObject({ httpStatus: 404 });
  });
});
