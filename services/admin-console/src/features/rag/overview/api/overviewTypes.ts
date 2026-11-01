import type { operations } from '@/contracts/rag';

export type RagOverview =
  operations['AnalyticsAdminController_overview']['responses'][200]['content']['application/json'];
export type RagDailyTurnCounts = RagOverview['daily'][number];
export type RagDocumentStatusCount = RagOverview['documents'][number];

/** Window lengths the overview offers; the API accepts 1–90 days. */
export const OVERVIEW_WINDOW_DAYS = [7, 30, 90] as const;
export type OverviewWindowDays = (typeof OVERVIEW_WINDOW_DAYS)[number];
