import type { operations } from '@/contracts/rag';

export type FeedbackEntry =
  operations['AdminConversationsController_listFeedback']['responses'][200]['content']['application/json'][number];

/** How many of the most recent ratings to load (the API allows 1–500). */
export const FEEDBACK_LIMIT_OPTIONS = [100, 250, 500] as const;
export type FeedbackLimit = (typeof FEEDBACK_LIMIT_OPTIONS)[number];
