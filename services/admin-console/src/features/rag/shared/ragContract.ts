/**
 * Helpers that read request and response shapes out of the generated rag contract
 * (`src/contracts/rag.ts`). rag's OpenAPI document inlines every schema, so the types
 * live on the operations rather than under `components`.
 */
import type { operations } from '@/contracts/rag';

type RagOperationName = keyof operations;

type SuccessResponses<OperationName extends RagOperationName> = operations[OperationName]['responses'];

/** The JSON body of an operation's success response (200, 201 or 202). */
export type RagResponseBody<OperationName extends RagOperationName> = {
  [Status in keyof SuccessResponses<OperationName>]: SuccessResponses<OperationName>[Status] extends {
    content: { 'application/json': infer Body };
  }
    ? Body
    : never;
}[keyof SuccessResponses<OperationName>];

/** The JSON request body of an operation. */
export type RagRequestBody<OperationName extends RagOperationName> = operations[OperationName] extends {
  requestBody: { content: { 'application/json': infer Body } };
}
  ? Body
  : never;

/** The query parameters of an operation. */
export type RagQueryParameters<OperationName extends RagOperationName> = NonNullable<
  operations[OperationName]['parameters']['query']
>;
