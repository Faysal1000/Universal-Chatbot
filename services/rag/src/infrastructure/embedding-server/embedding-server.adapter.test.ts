import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { jsonResponder, ScriptedHttpServer } from '../../../test/support/scripted-http-server.js';
import { validTestEnvironment } from '../../../test/support/test-environment.js';
import { UpstreamServiceError } from '../../common/outbound-http/upstream-service-error.js';
import { parseConfiguration } from '../../config/configuration.js';
import { EmbeddingServerAdapter } from './embedding-server.adapter.js';

const embeddingResponse = (vectors: number[][], model = 'google/embeddinggemma-2') => ({
  model,
  model_revision: 'abc123',
  dimension: vectors[0]?.length ?? 0,
  count: vectors.length,
  embeddings: vectors,
});

describe('EmbeddingServerAdapter', () => {
  let embeddingServer: ScriptedHttpServer;
  let adapter: EmbeddingServerAdapter;

  beforeEach(async () => {
    embeddingServer = await ScriptedHttpServer.start();
    adapter = new EmbeddingServerAdapter(
      parseConfiguration(
        validTestEnvironment({
          RAG_EMBEDDING_SERVER_URL: embeddingServer.baseUrl,
          RAG_EMBEDDING_BATCH_SIZE: '2',
        }),
      ),
    );
  });

  afterEach(async () => {
    await embeddingServer.stop();
  });

  it('sends documents with task and title, split into batches, and keeps input order', async () => {
    embeddingServer.respondWith(
      jsonResponder(
        200,
        embeddingResponse([
          [1, 0],
          [0, 1],
        ]),
      ),
      jsonResponder(200, embeddingResponse([[0.5, 0.5]])),
    );

    const result = await adapter.embedDocuments([
      { kind: 'text', text: 'first', title: 'Handbook' },
      { kind: 'text', text: 'second' },
      { kind: 'image', imageBase64: 'aW1hZ2U=' },
    ]);

    expect(result.vectors).toEqual([
      [1, 0],
      [0, 1],
      [0.5, 0.5],
    ]);
    expect(result.modelIdentity).toEqual({
      model: 'google/embeddinggemma-2',
      modelRevision: 'abc123',
      dimension: 2,
    });
    const [firstRequest, secondRequest] = embeddingServer.recordedRequests;
    expect(firstRequest?.headers['x-api-key']).toBe('test-embedding-server-api-key');
    expect(JSON.parse(firstRequest?.bodyText ?? '')).toEqual({
      items: [
        { type: 'text', text: 'first', task: 'document', title: 'Handbook' },
        { type: 'text', text: 'second', task: 'document' },
      ],
    });
    expect(JSON.parse(secondRequest?.bodyText ?? '')).toEqual({
      items: [{ type: 'image', image_base64: 'aW1hZ2U=' }],
    });
  });

  it('retries a 503 honouring Retry-After, then succeeds', async () => {
    embeddingServer.respondWith(
      jsonResponder(503, { detail: 'queue full' }, { 'retry-after': '0' }),
      jsonResponder(200, embeddingResponse([[1, 0]])),
    );

    const result = await adapter.embedQueries([{ kind: 'text', text: 'opening hours?' }]);

    expect(result.vectors).toEqual([[1, 0]]);
    expect(embeddingServer.recordedRequests).toHaveLength(2);
    expect(JSON.parse(embeddingServer.recordedRequests[0]?.bodyText ?? '')).toEqual({
      items: [{ type: 'text', text: 'opening hours?', task: 'query' }],
    });
  });

  it('fails permanently on a validation error and names the failing item', async () => {
    embeddingServer.respondWith(jsonResponder(422, { detail: 'text too long', item_index: 0 }));

    const failure = adapter.embedQueries([{ kind: 'text', text: 'x' }]);

    await expect(failure).rejects.toBeInstanceOf(UpstreamServiceError);
    await expect(failure).rejects.toThrow('item 0: text too long');
    expect(embeddingServer.recordedRequests).toHaveLength(1);
  });

  it('rejects a response whose vector count does not match the request', async () => {
    embeddingServer.respondWith(jsonResponder(200, embeddingResponse([[1, 0]])));

    await expect(
      adapter.embedQueries([
        { kind: 'text', text: 'a' },
        { kind: 'text', text: 'b' },
      ]),
    ).rejects.toThrow('unexpected response shape');
  });
});
