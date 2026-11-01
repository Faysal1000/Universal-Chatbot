/**
 * TypeScript mirror of the analytics models in `services/llm-gateway/app/schemas/analytics.py`.
 * Field names stay snake_case so payloads pass through unchanged.
 */

import type { IsoDateTimeString } from '@/shared/api/types';

export type AnalyticsGroupBy = 'model' | 'provider' | 'task';

/** p50/p90/p99 of one measurement (`null` when there is no data). */
interface PercentileSummary {
  p50: number | null;
  p90: number | null;
  p99: number | null;
}

export interface AnalyticsGroupSummary {
  group_key: string;
  provider_id: string | null;
  model_id: string | null;
  task_name: string | null;
  request_count: number;
  success_count: number;
  error_count: number;
  error_rate: number;
  fallback_count: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_tokens: number;
  cost_usd: number | null;
  latency_ms: PercentileSummary;
  time_to_first_token_ms: PercentileSummary;
  output_tokens_per_second: PercentileSummary;
}

export interface AnalyticsOverviewResponse {
  start: IsoDateTimeString;
  end: IsoDateTimeString;
  group_by: AnalyticsGroupBy;
  unique_request_count: number;
  totals: AnalyticsGroupSummary;
  groups: AnalyticsGroupSummary[];
}

export interface TimeseriesPoint {
  bucket_start: IsoDateTimeString;
  group_key: string;
  request_count: number;
  error_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  latency_p50_ms: number | null;
  latency_p90_ms: number | null;
  latency_p99_ms: number | null;
  time_to_first_token_p50_ms: number | null;
  time_to_first_token_p90_ms: number | null;
  time_to_first_token_p99_ms: number | null;
  output_tokens_per_second_p50: number | null;
}

/** Bucketed series; buckets without traffic are omitted by the backend. */
export interface AnalyticsTimeseriesResponse {
  start: IsoDateTimeString;
  end: IsoDateTimeString;
  bucket_seconds: number;
  group_by: AnalyticsGroupBy;
  points: TimeseriesPoint[];
}

export interface TopErrorEntry {
  error_class: string;
  provider_id: string;
  model_id: string;
  http_status: number;
  occurrence_count: number;
  last_seen_at: IsoDateTimeString;
  sample_message: string | null;
}

/** One recent request-metrics row (no bodies are ever stored). */
export interface RecentRequestEntry {
  started_at: IsoDateTimeString;
  request_id: string;
  task_name: string;
  provider_id: string;
  model_id: string;
  upstream_protocol: string;
  is_stream: boolean;
  is_fallback: boolean;
  http_status: number;
  error_class: string | null;
  error_message: string | null;
  attempt_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  time_to_first_token_ms: number | null;
  total_duration_ms: number;
  output_tokens_per_second: number | null;
  cost_usd: number | null;
  /** Cost avoided by the provider's prompt cache. */
  cost_saved_usd: number | null;
  /** Position in the task's model chain of this row's model. */
  chain_step: number | null;
  /** Chain steps reached so far, including skipped ones. */
  chain_steps_tried: number | null;
  /** Why the chain moved past the previous step: its error class, or `circuit_open`. */
  fallback_reason: string | null;
}
