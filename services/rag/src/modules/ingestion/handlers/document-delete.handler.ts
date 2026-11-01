import { Injectable, Logger } from '@nestjs/common';

import type { JobContext, QueueJobHandler } from '../../../queue/queue-job-handler.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { type DeleteDocumentPayload, deleteDocumentPayloadSchema } from '../ingestion-jobs.js';
import { DeleteDocumentService } from '../stages/delete-document.service.js';

@Injectable()
export class DocumentDeleteHandler implements QueueJobHandler<DeleteDocumentPayload> {
  private readonly logger = new Logger(DocumentDeleteHandler.name);
  readonly queueName = QUEUE_NAMES.documentDelete;
  readonly payloadSchema = deleteDocumentPayloadSchema;

  constructor(private readonly deleteDocument: DeleteDocumentService) {}

  async handle({ payload }: JobContext<DeleteDocumentPayload>): Promise<void> {
    await this.deleteDocument.delete(payload.documentId);
  }

  // The document stays in status `deleting`; the dead-letter copy lets an admin retry.
  onFinalFailure(payload: DeleteDocumentPayload, error: Error): Promise<void> {
    this.logger.error({ err: error, documentId: payload.documentId }, 'Document deletion failed');
    return Promise.resolve();
  }
}
