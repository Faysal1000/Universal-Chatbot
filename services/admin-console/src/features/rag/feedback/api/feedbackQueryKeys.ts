import type { FeedbackLimit } from './feedbackTypes';

/** TanStack Query keys for visitor feedback. */
export const feedbackQueryKeys = {
  all: ['rag', 'feedback'] as const,
  recent: (limit: FeedbackLimit) => [...feedbackQueryKeys.all, limit] as const,
};
