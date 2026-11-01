import type { OverviewWindowDays } from './overviewTypes';

/** TanStack Query keys for the RAG analytics overview. */
export const overviewQueryKeys = {
  all: ['rag', 'overview'] as const,
  window: (days: OverviewWindowDays) => [...overviewQueryKeys.all, days] as const,
};
