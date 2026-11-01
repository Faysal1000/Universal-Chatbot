/** TanStack Query keys for providers and their models. */
export const providerQueryKeys = {
  all: ['providers'] as const,
  detail: (providerId: string) => ['providers', providerId] as const,
};
