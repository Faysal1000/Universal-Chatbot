import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable } from '@nestjs/common';

import type { ServerSentEventStream } from '../../common/http/server-sent-events.js';
import type { DocumentStatus } from '../../database/schema.js';
import { IngestionRunsRepository } from '../ingestion/ingestion-runs.repository.js';
import { documentPresenter } from './document-presenter.js';
import type { DocumentProgressEvent } from './documents-admin.schemas.js';
import { DocumentsRepository } from './documents.repository.js';

const POLL_INTERVAL_MILLISECONDS = 1_000;
const MAXIMUM_STREAM_DURATION_MILLISECONDS = 60 * 60_000;
const SETTLED_STATUSES: ReadonlySet<DocumentStatus> = new Set(['ready', 'failed']);

/**
 * Streams a document's ingestion progress to the admin console. It polls Postgres once
 * a second rather than subscribing to pub/sub: a handful of admins at most watch at a
 * time, and the database already holds the authoritative state.
 */
@Injectable()
export class DocumentProgressStreamService {
  constructor(
    private readonly documentsRepository: DocumentsRepository,
    private readonly ingestionRunsRepository: IngestionRunsRepository,
  ) {}

  async stream(documentId: string, eventStream: ServerSentEventStream): Promise<void> {
    const deadline = Date.now() + MAXIMUM_STREAM_DURATION_MILLISECONDS;
    let previousSnapshot = '';
    while (eventStream.isClientConnected && Date.now() < deadline) {
      const progress = await this.readProgress(documentId);
      if (progress === undefined) {
        eventStream.send('deleted', { documentId });
        break;
      }
      const snapshot = JSON.stringify(progress);
      if (snapshot !== previousSnapshot) eventStream.send('progress', progress);
      previousSnapshot = snapshot;
      if (SETTLED_STATUSES.has(progress.status)) break;
      await sleep(POLL_INTERVAL_MILLISECONDS);
    }
    eventStream.end();
  }

  private async readProgress(documentId: string): Promise<DocumentProgressEvent | undefined> {
    const document = await this.documentsRepository.findById(documentId);
    if (document === undefined) return undefined;
    const [latestRun] = await this.ingestionRunsRepository.listForDocument(documentId, 1);
    return {
      documentId,
      status: document.status,
      run: latestRun === undefined ? null : documentPresenter.ingestionRun(latestRun),
    };
  }
}
