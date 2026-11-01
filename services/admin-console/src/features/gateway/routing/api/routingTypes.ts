/**
 * TypeScript mirror of the task routing models in `services/llm-gateway/app/schemas/routing.py`
 * and the task list in `services/llm-gateway/app/schemas/task_catalog.py`.
 * Field names stay snake_case so payloads pass through unchanged.
 */

import type { IsoDateTimeString } from '@/shared/api/types';

/** Fewest and most steps a model chain may hold (`MAX_CHAIN_STEPS` in the backend). */
export const MIN_CHAIN_STEPS = 1;
export const MAX_CHAIN_STEPS = 10;
export const MIN_STEP_ATTEMPTS = 1;
export const MAX_STEP_ATTEMPTS = 10;
export const MAX_STEP_TIMEOUT_SECONDS = 3600;

/** A built-in task (what callers send as `model`). The list is fixed by the gateway's migrations. */
export interface TaskResponse {
  task_name: string;
  description: string | null;
  requires_vision: boolean;
  has_route: boolean;
  created_at: IsoDateTimeString;
  updated_at: IsoDateTimeString;
}

export type BreakerStatusName = 'closed' | 'open' | 'half_open';

/** One step of a model chain; steps are tried in list order. */
export interface ChainStepRequest {
  model_pk: number;
  /** 1–10 tries on this model; `null` uses the gateway default (omitted means 1). */
  max_attempts?: number | null;
  /** Replaces the provider's request timeout for this step (> 0, ≤ 3600); `null` keeps the provider's. */
  timeout_seconds?: number | null;
  /** A disabled step stays in the chain but is never tried. */
  is_enabled?: boolean;
}

/** A whole chain, replaced atomically: 1–10 steps, each model at most once. */
export interface ModelChainRequest {
  steps: ChainStepRequest[];
  /** Try the gateway-wide default model after the last step, when it is not already in the chain. */
  append_default_model: boolean;
}

export interface TaskRouteCreateRequest extends ModelChainRequest {
  task_name: string;
  description?: string | null;
  is_enabled?: boolean;
}

/** Partial update of route settings; the chain itself is replaced with PUT .../chain. */
export interface TaskRouteUpdateRequest {
  description?: string | null;
  is_enabled?: boolean;
  append_default_model?: boolean;
}

export interface ChainStepResponse {
  /** 1-based order in the chain. */
  position: number;
  model_pk: number;
  model_name: string;
  max_attempts: number | null;
  timeout_seconds: number | null;
  is_enabled: boolean;
  breaker_status: BreakerStatusName;
}

export interface TaskRouteResponse {
  task_name: string;
  description: string | null;
  is_enabled: boolean;
  append_default_model: boolean;
  steps: ChainStepResponse[];
  /** The appended default model, if appended and set. */
  default_model_pk: number | null;
  default_model_name: string | null;
  created_at: IsoDateTimeString;
  updated_at: IsoDateTimeString;
}

/** A model's circuit breaker; only models with recent consecutive failures are listed. */
export interface CircuitBreakerResponse {
  model_pk: number;
  model_name: string;
  status: BreakerStatusName;
  consecutive_failures: number;
  failure_threshold: number;
  cooldown_seconds: number;
  cooldown_remaining_seconds: number;
  last_failure_at: IsoDateTimeString | null;
  last_error_class: string | null;
  opened_count: number;
}

export interface CircuitBreakerResetResponse {
  reset_count: number;
}

export interface GatewaySettingsResponse {
  default_model_pk: number | null;
  default_model_name: string | null;
}

/** `null` clears the default model. */
export interface GatewaySettingsUpdateRequest {
  default_model_pk: number | null;
}
