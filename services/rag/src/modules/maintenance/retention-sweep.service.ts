import { Inject, Injectable, Logger } from '@nestjs/common';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../ports/object-storage.port.js';
import { ChatAttachmentsRepository } from '../chat/persistence/chat-attachments.repository.js';
import { RetrievalTracesRepository } from '../chat/persistence/retrieval-traces.repository.js';
import { VisitorSessionsRepository } from '../public-access/visitor-sessions.repository.js';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface RetentionSweepResult {
  readonly unboundAttachmentsDeleted: number;
  readonly visitorSessionsDeleted: number;
  readonly retrievalTracesDeleted: number;
  readonly objectDeletionFailures: number;
}

/**
 * Deletes what the retention policy no longer needs: images uploaded but never sent,
 * visitor sessions (with their conversations and images) long after they expired, and
 * old retrieval traces. Rows go only after their stored objects, so a failed object
 * deletion is retried on the next sweep instead of leaving an orphan behind.
 */
@Injectable()
export class RetentionSweepService {
  private readonly logger = new Logger(RetentionSweepService.name);

  constructor(
    private readonly chatAttachmentsRepository: ChatAttachmentsRepository,
    private readonly visitorSessionsRepository: VisitorSessionsRepository,
    private readonly retrievalTracesRepository: RetrievalTracesRepository,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async sweep(now: Date): Promise<RetentionSweepResult> {
    const retention = this.configuration.retention;
    const expiredAttachments = await this.chatAttachmentsRepository.listExpired(now);
    const unboundFailures = await this.deleteObjects(
      expiredAttachments.map((attachment) => attachment.storageKey),
    );
    const unboundAttachments = unboundFailures === 0 ? expiredAttachments : [];
    await this.chatAttachmentsRepository.deleteByIds(unboundAttachments.map((attachment) => attachment.id));

    const sessionCutoff = daysBefore(now, retention.visitorDataRetentionDays);
    const sessionObjectKeys =
      await this.chatAttachmentsRepository.listStorageKeysOfSessionsExpiredBefore(sessionCutoff);
    const sessionFailures = await this.deleteObjects(sessionObjectKeys);
    const visitorSessionsDeleted =
      sessionFailures === 0 ? await this.visitorSessionsRepository.deleteExpiredBefore(sessionCutoff) : 0;

    const result: RetentionSweepResult = {
      unboundAttachmentsDeleted: unboundAttachments.length,
      visitorSessionsDeleted,
      retrievalTracesDeleted: await this.retrievalTracesRepository.deleteOlderThan(
        daysBefore(now, retention.retrievalTraceRetentionDays),
      ),
      objectDeletionFailures: unboundFailures + sessionFailures,
    };
    this.logger.log({ ...result }, 'Retention sweep finished');
    return result;
  }

  /** Returns how many deletions failed; the rest are gone. */
  private async deleteObjects(storageKeys: readonly string[]): Promise<number> {
    const outcomes = await Promise.allSettled(storageKeys.map((key) => this.objectStorage.deleteObject(key)));
    const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
    if (failures.length > 0) {
      const firstReason: unknown = failures[0]?.reason;
      this.logger.warn(
        { failureCount: failures.length, err: firstReason },
        'Could not delete stored objects',
      );
    }
    return failures.length;
  }
}

function daysBefore(moment: Date, days: number): Date {
  return new Date(moment.getTime() - days * DAY_IN_MILLISECONDS);
}
