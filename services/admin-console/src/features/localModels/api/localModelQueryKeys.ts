/** TanStack Query keys for the local-llm admin API. */
export const localModelQueryKeys = {
  all: ['local-models'] as const,
  deployments: ['local-models', 'deployments'] as const,
  system: ['local-models', 'system'] as const,
};
