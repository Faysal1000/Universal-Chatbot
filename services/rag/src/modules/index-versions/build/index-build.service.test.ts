import { describe, expect, it } from 'vitest';

import type { DocumentRecord, DocumentsRepository } from '../../documents/documents.repository.js';
import type { DocumentIndexer } from '../../ingestion/document-indexer.service.js';
import type { ChunksRepository, MissingDocument } from '../chunks.repository.js';
import type { IndexVersionRecord, IndexVersionsRepository } from '../index-versions.repository.js';
import { IndexBuildService } from './index-build.service.js';

function indexVersion(status: IndexVersionRecord['status']): IndexVersionRecord {
  return { id: 2, status } as IndexVersionRecord;
}

function buildScenario(options: {
  version: IndexVersionRecord;
  missingRounds: MissingDocument[][];
  documentStatuses: Record<string, DocumentRecord['status']>;
}) {
  const events: string[] = [];
  const remainingRounds = [...options.missingRounds];
  const indexVersions = {
    findById: () => Promise.resolve(options.version),
    markReady: (id: number) => {
      events.push(`ready ${id}`);
      return Promise.resolve();
    },
  } as unknown as IndexVersionsRepository;
  const chunks = {
    findDocumentsMissingFromVersion: () => Promise.resolve(remainingRounds.shift() ?? []),
  } as unknown as ChunksRepository;
  const documents = {
    findById: (id: string) =>
      Promise.resolve(
        options.documentStatuses[id] === undefined ? undefined : { id, status: options.documentStatuses[id] },
      ),
  } as unknown as DocumentsRepository;
  const indexer = {
    chunkRun: (document: DocumentRecord, runId: string) => {
      events.push(`chunk ${document.id}/${runId}`);
      return Promise.resolve([]);
    },
    embedChunks: (document: DocumentRecord) => {
      events.push(`embed ${document.id}`);
      return Promise.resolve();
    },
  } as unknown as DocumentIndexer;
  return { service: new IndexBuildService(indexVersions, chunks, documents, indexer), events };
}

describe('IndexBuildService', () => {
  it('indexes every missing ready document and marks a new version ready', async () => {
    const { service, events } = buildScenario({
      version: indexVersion('building'),
      missingRounds: [[{ documentId: 'doc-a', ingestionRunId: 'run-a' }]],
      documentStatuses: { 'doc-a': 'ready' },
    });

    await expect(service.build(2)).resolves.toEqual({ indexedDocuments: 1 });

    expect(events).toEqual(['chunk doc-a/run-a', 'embed doc-a', 'ready 2']);
  });

  it('skips a document that started reprocessing meanwhile', async () => {
    const { service, events } = buildScenario({
      version: indexVersion('building'),
      missingRounds: [[{ documentId: 'doc-b', ingestionRunId: 'run-b' }]],
      documentStatuses: { 'doc-b': 'parsing' },
    });

    await expect(service.build(2)).resolves.toEqual({ indexedDocuments: 0 });

    expect(events).toEqual(['ready 2']);
  });

  it('catches a retired version up without changing its status', async () => {
    const { service, events } = buildScenario({
      version: indexVersion('retired'),
      missingRounds: [[{ documentId: 'doc-c', ingestionRunId: 'run-c' }], []],
      documentStatuses: { 'doc-c': 'ready' },
    });

    await service.build(2);

    expect(events).not.toContain('ready 2');
  });

  it('refuses to build a failed version', async () => {
    const { service } = buildScenario({
      version: indexVersion('failed'),
      missingRounds: [],
      documentStatuses: {},
    });

    await expect(service.build(2)).rejects.toMatchObject({ failureCode: 'index_version_not_buildable' });
  });
});
