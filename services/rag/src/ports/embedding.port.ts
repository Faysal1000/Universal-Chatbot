/** An item to embed. Images are raw Base64 (JPEG, PNG or WEBP), never URLs. */
export type EmbeddingInput =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly imageBase64: string }
  | { readonly kind: 'text_image'; readonly text: string; readonly imageBase64: string };

/** Document inputs may carry the source title, which the model uses as passage context. */
export type DocumentEmbeddingInput = EmbeddingInput & { readonly title?: string };

/** Identifies the vector space; vectors from different identities are not comparable. */
export interface EmbeddingModelIdentity {
  readonly model: string;
  readonly modelRevision: string | null;
  readonly dimension: number;
}

export interface EmbeddingBatchResult {
  readonly modelIdentity: EmbeddingModelIdentity;
  /** One L2-normalised vector per input, in input order. */
  readonly vectors: readonly (readonly number[])[];
}

export interface EmbeddingPort {
  /** Embeds passages for indexing (`task=document`). Any number of inputs; batching is internal. */
  embedDocuments(inputs: readonly DocumentEmbeddingInput[]): Promise<EmbeddingBatchResult>;
  /** Embeds search queries (`task=query`). */
  embedQueries(inputs: readonly EmbeddingInput[], abortSignal?: AbortSignal): Promise<EmbeddingBatchResult>;
}

export const EMBEDDING_PORT = Symbol('EMBEDDING_PORT');
