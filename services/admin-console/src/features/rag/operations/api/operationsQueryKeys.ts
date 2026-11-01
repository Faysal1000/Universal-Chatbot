/** TanStack Query keys for queues and dead letters. */
export const operationsQueryKeys = {
  queues: ['rag', 'queues'] as const,
  deadLetters: ['rag', 'dead-letters'] as const,
  deadLetterPage: (offset: number) => [...operationsQueryKeys.deadLetters, offset] as const,
};
