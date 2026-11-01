import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { sendJsonRequest } from '../../common/outbound-http/json-http-client.js';
import { type RetryPolicy, retryWithBackoff } from '../../common/outbound-http/retry-with-backoff.js';
import { UpstreamServiceError } from '../../common/outbound-http/upstream-service-error.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import type {
  DocumentEmbeddingInput,
  EmbeddingBatchResult,
  EmbeddingInput,
  EmbeddingModelIdentity,
  EmbeddingPort,
} from '../../ports/embedding.port.js';

const SERVICE_NAME = 'embedding-server';
/** The server rejects titles longer than this; titles are context, so truncating is safe. */
const MAXIMUM_TITLE_CHARACTERS = 512;

/** Indexing tolerates long waits (the server queues work); queries must stay fast. */
const DOCUMENT_RETRY_POLICY: RetryPolicy = {
  maximumAttempts: 5,
  initialDelayMilliseconds: 1_000,
  maximumDelayMilliseconds: 30_000,
};
const QUERY_RETRY_POLICY: RetryPolicy = {
  maximumAttempts: 2,
  initialDelayMilliseconds: 200,
  maximumDelayMilliseconds: 1_000,
};

const batchEmbeddingResponseSchema = z.object({
  model: z.string(),
  model_revision: z.string().nullable(),
  dimension: z.number().int().positive(),
  count: z.number().int().nonnegative(),
  embeddings: z.array(z.array(z.number())),
});

type EmbeddingTask = 'document' | 'query';
type WireItem = Record<string, string>;

/** Client for `POST /v1/embed/batch` of services/embedding-server. */
@Injectable()
export class EmbeddingServerAdapter implements EmbeddingPort {
  private readonly settings: ServiceConfiguration['embeddingServer'];

  constructor(@Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration) {
    this.settings = configuration.embeddingServer;
  }

  embedDocuments(inputs: readonly DocumentEmbeddingInput[]): Promise<EmbeddingBatchResult> {
    const wireItems = inputs.map((input) => toWireItem(input, 'document', input.title));
    return this.embedInBatches(wireItems, DOCUMENT_RETRY_POLICY);
  }

  embedQueries(inputs: readonly EmbeddingInput[], abortSignal?: AbortSignal): Promise<EmbeddingBatchResult> {
    const wireItems = inputs.map((input) => toWireItem(input, 'query', undefined));
    return this.embedInBatches(wireItems, QUERY_RETRY_POLICY, abortSignal);
  }

  private async embedInBatches(
    wireItems: readonly WireItem[],
    retryPolicy: RetryPolicy,
    abortSignal?: AbortSignal,
  ): Promise<EmbeddingBatchResult> {
    if (wireItems.length === 0) throw new RangeError('At least one input is required');
    const vectors: (readonly number[])[] = [];
    let modelIdentity: EmbeddingModelIdentity | undefined;
    for (let offset = 0; offset < wireItems.length; offset += this.settings.batchSize) {
      const batch = wireItems.slice(offset, offset + this.settings.batchSize);
      const response = await retryWithBackoff(
        () => this.requestBatch(batch, abortSignal),
        retryPolicy,
        abortSignal,
      );
      modelIdentity = assertSameModel(modelIdentity, response.modelIdentity);
      vectors.push(...response.vectors);
    }
    return { modelIdentity: modelIdentity as EmbeddingModelIdentity, vectors };
  }

  private async requestBatch(
    batch: readonly WireItem[],
    abortSignal?: AbortSignal,
  ): Promise<EmbeddingBatchResult> {
    const responseBody = await sendJsonRequest(
      SERVICE_NAME,
      'embed batch',
      {
        method: 'POST',
        url: `${this.settings.url}/v1/embed/batch`,
        headers: { 'x-api-key': this.settings.apiKey.reveal() },
        body: { items: batch },
        timeoutMilliseconds: this.settings.timeoutMilliseconds,
        ...(abortSignal === undefined ? {} : { abortSignal }),
      },
      describeEmbeddingServerError,
    );
    return parseBatchResponse(responseBody, batch.length);
  }
}

function toWireItem(input: EmbeddingInput, task: EmbeddingTask, title: string | undefined): WireItem {
  const titleField: WireItem =
    title === undefined || title.trim() === '' ? {} : { title: title.slice(0, MAXIMUM_TITLE_CHARACTERS) };
  switch (input.kind) {
    case 'text':
      return { type: 'text', text: input.text, task, ...titleField };
    case 'image':
      return { type: 'image', image_base64: input.imageBase64 };
    case 'text_image':
      return { type: 'text_image', text: input.text, image_base64: input.imageBase64, task, ...titleField };
  }
}

function parseBatchResponse(responseBody: unknown, expectedCount: number): EmbeddingBatchResult {
  const parsed = batchEmbeddingResponseSchema.safeParse(responseBody);
  if (!parsed.success || parsed.data.embeddings.length !== expectedCount) {
    throw new UpstreamServiceError(SERVICE_NAME, 'embed batch', 'unexpected response shape', {
      isRetryable: false,
    });
  }
  const { model, model_revision: modelRevision, dimension, embeddings } = parsed.data;
  if (embeddings.some((vector) => vector.length !== dimension)) {
    throw new UpstreamServiceError(SERVICE_NAME, 'embed batch', 'vector length differs from dimension', {
      isRetryable: false,
    });
  }
  return { modelIdentity: { model, modelRevision, dimension }, vectors: embeddings };
}

/** A model swap mid-request would mix vector spaces, so it is a hard failure. */
function assertSameModel(
  previous: EmbeddingModelIdentity | undefined,
  current: EmbeddingModelIdentity,
): EmbeddingModelIdentity {
  if (
    previous !== undefined &&
    (previous.model !== current.model ||
      previous.modelRevision !== current.modelRevision ||
      previous.dimension !== current.dimension)
  ) {
    throw new UpstreamServiceError(SERVICE_NAME, 'embed batch', 'model changed between batches', {
      isRetryable: true,
    });
  }
  return current;
}

function describeEmbeddingServerError(errorBody: unknown): { message: string } {
  if (typeof errorBody === 'object' && errorBody !== null) {
    const { detail, item_index: itemIndex } = errorBody as { detail?: unknown; item_index?: unknown };
    if (typeof detail === 'string') {
      return { message: typeof itemIndex === 'number' ? `item ${itemIndex}: ${detail}` : detail };
    }
    if (Array.isArray(detail)) return { message: JSON.stringify(detail).slice(0, 500) };
  }
  return { message: typeof errorBody === 'string' ? errorBody : 'no error details' };
}
