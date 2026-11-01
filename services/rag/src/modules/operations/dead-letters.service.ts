import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ApplicationError } from '../../common/errors/application-error.js';
import type { DeadLetterRecord } from '../../queue/dead-letter-record.js';
import { parseJobEnvelope } from '../../queue/job-envelope.js';
import {
  type DeadLetterPage,
  QueueAdministrationService,
  type StoredDeadLetter,
} from '../../queue/queue-administration.service.js';
import { QueueProducerService } from '../../queue/queue-producer.service.js';
import { QUEUE_NAMES, type QueueName } from '../../queue/queue-names.js';
import { auditActorOf } from '../admin-auth/admin-principal.js';
import { AuditEventsRepository } from '../audit/audit-events.repository.js';
import { type AdminAction, DocumentsAdminService } from '../documents/documents-admin.service.js';

export type DeadLetterRetryOutcome =
  | { readonly action: 'document_reprocessed'; readonly documentId: string; readonly ingestionRunId: string }
  | { readonly action: 'job_retried'; readonly queueName: string; readonly jobId: string };

const documentPayloadSchema = z.object({ documentId: z.uuid() });
const KNOWN_QUEUE_NAMES = new Set<string>(Object.values(QUEUE_NAMES));

/**
 * Dead letters are copies of jobs that used up their retries. Retrying an ingestion job
 * starts a fresh run of its document, because the failed run was already closed; any
 * other job is moved back to its queue with fresh attempts.
 */
@Injectable()
export class DeadLettersService {
  constructor(
    private readonly queueAdministration: QueueAdministrationService,
    private readonly queueProducer: QueueProducerService,
    private readonly documentsAdmin: DocumentsAdminService,
    private readonly auditEventsRepository: AuditEventsRepository,
  ) {}

  list(offset: number, limit: number): Promise<DeadLetterPage> {
    return this.queueAdministration.listDeadLetters(offset, limit);
  }

  async retry(deadLetterId: string, action: AdminAction): Promise<DeadLetterRetryOutcome> {
    const deadLetter = await this.findOrFail(deadLetterId);
    const outcome = isIngestionQueue(deadLetter.record.originalQueueName)
      ? await this.reprocessDocument(deadLetter.record, action)
      : await this.retryJob(deadLetter.record);
    await this.queueAdministration.discardDeadLetter(deadLetterId);
    await this.audit(action, 'dead_letter.retried', deadLetterId, { ...outcome });
    return outcome;
  }

  async discard(deadLetterId: string, action: AdminAction): Promise<void> {
    const deadLetter = await this.findOrFail(deadLetterId);
    await this.queueAdministration.discardDeadLetter(deadLetterId);
    await this.audit(action, 'dead_letter.discarded', deadLetterId, {
      originalQueueName: deadLetter.record.originalQueueName,
      failureCode: deadLetter.record.failureCode,
    });
  }

  private async findOrFail(deadLetterId: string): Promise<StoredDeadLetter> {
    const deadLetter = await this.queueAdministration.findDeadLetter(deadLetterId);
    if (deadLetter === undefined) {
      throw new ApplicationError(404, 'dead_letter_not_found', 'No dead letter with this id.');
    }
    return deadLetter;
  }

  private async reprocessDocument(
    record: DeadLetterRecord,
    action: AdminAction,
  ): Promise<DeadLetterRetryOutcome> {
    const payload = documentPayloadSchema.safeParse(payloadOf(record));
    if (!payload.success) throw notRetryableError('The job does not name a document.');
    const run = await this.documentsAdmin.reprocess(payload.data.documentId, action);
    return { action: 'document_reprocessed', ...run };
  }

  private async retryJob(record: DeadLetterRecord): Promise<DeadLetterRetryOutcome> {
    const queueName = record.originalQueueName;
    const jobId = record.originalJobId;
    if (!isKnownQueueName(queueName) || jobId === undefined) {
      throw notRetryableError('The job came from an unknown queue.');
    }
    const wasRetried = await this.queueAdministration.retryFailedJob(queueName, jobId);
    // The failed job may already have been cleaned up; add it again under the same id.
    if (!wasRetried) {
      await this.queueProducer.enqueue(queueName, record.originalJobName, payloadOf(record), { jobId });
    }
    return { action: 'job_retried', queueName, jobId };
  }

  private async audit(
    action: AdminAction,
    auditAction: string,
    deadLetterId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.auditEventsRepository.record({
      actor: auditActorOf(action.principal),
      action: auditAction,
      targetType: 'dead_letter',
      targetId: deadLetterId,
      details,
      ...(action.requestId === undefined ? {} : { requestId: action.requestId }),
    });
  }
}

function payloadOf(record: DeadLetterRecord): unknown {
  try {
    return parseJobEnvelope(record.payload).payload;
  } catch {
    throw notRetryableError('The stored job is not a valid job envelope.');
  }
}

function isIngestionQueue(queueName: string): boolean {
  return queueName.startsWith('ingest.') || queueName.startsWith('parse.');
}

function isKnownQueueName(queueName: string): queueName is QueueName {
  return KNOWN_QUEUE_NAMES.has(queueName);
}

function notRetryableError(detail: string): ApplicationError {
  return new ApplicationError(409, 'dead_letter_not_retryable', `${detail} Discard it instead.`);
}
