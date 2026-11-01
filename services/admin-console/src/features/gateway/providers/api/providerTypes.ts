/**
 * TypeScript mirror of the provider and model models in `services/llm-gateway/app/schemas/providers.py`.
 * Field names stay snake_case so payloads pass through unchanged.
 */

import type { IsoDateTimeString } from '@/shared/api/types';

export type ApiProtocolName = 'openai_chat_completions' | 'openai_responses' | 'anthropic_messages';

/** Mirrors `ModelCapability` in `app/core/model_capabilities.py`. */
export type ModelCapability = 'vision';

/**
 * How a caller's `reasoning_effort` reaches the model (mirrors `app/core/reasoning_control.py`):
 * passed on as is, or rewritten to `chat_template_kwargs.enable_thinking` for chat templates with a thinking switch.
 */
export type ReasoningControl = 'reasoning_effort' | 'enable_thinking';
export const DEFAULT_REASONING_CONTROL: ReasoningControl = 'reasoning_effort';

/** Mirrors `PROVIDER_ID_PATTERN` in `app/core/identifiers.py`. */
export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;

/** One extra header sent to the provider. `value: null` keeps the stored value. */
export interface ExtraHeaderInput {
  name: string;
  value: string | null;
}

export interface ProviderCreateRequest {
  provider_id: string;
  display_name: string;
  base_url: string;
  api_protocol: ApiProtocolName;
  api_key?: string | null;
  extra_headers?: ExtraHeaderInput[];
  is_enabled?: boolean;
  request_timeout_seconds?: number;
  max_concurrent_requests?: number;
}

/**
 * Partial update; omitted fields are unchanged.
 * `api_key`: omit to keep, a value to replace, `clear_api_key: true` to remove.
 * `extra_headers`: omit to keep; when sent it replaces the whole list.
 */
export interface ProviderUpdateRequest {
  display_name?: string;
  base_url?: string;
  api_protocol?: ApiProtocolName;
  api_key?: string;
  clear_api_key?: boolean;
  extra_headers?: ExtraHeaderInput[];
  is_enabled?: boolean;
  request_timeout_seconds?: number;
  max_concurrent_requests?: number;
}

export interface ProviderModelCreateRequest {
  model_id: string;
  display_name?: string | null;
  is_enabled?: boolean;
  default_max_output_tokens?: number | null;
  context_window_tokens?: number | null;
  max_output_tokens?: number | null;
  capabilities?: ModelCapability[];
  base_url_override?: string | null;
  api_protocol_override?: ApiProtocolName | null;
  reasoning_control?: ReasoningControl;
  /** Consecutive failures that open the circuit breaker (1–100); `null` = gateway default. */
  breaker_failure_threshold?: number | null;
  /** Seconds an open breaker skips the model (1–86400); `null` = gateway default. */
  breaker_cooldown_seconds?: number | null;
  input_price_usd_per_million_tokens?: number | null;
  cached_input_price_usd_per_million_tokens?: number | null;
  output_price_usd_per_million_tokens?: number | null;
}

/** Partial update; send `null` explicitly to clear an optional field. `capabilities` replaces the list. */
export interface ProviderModelUpdateRequest {
  model_id?: string;
  display_name?: string | null;
  is_enabled?: boolean;
  default_max_output_tokens?: number | null;
  context_window_tokens?: number | null;
  max_output_tokens?: number | null;
  capabilities?: ModelCapability[];
  base_url_override?: string | null;
  api_protocol_override?: ApiProtocolName | null;
  /** `null` or omitted keeps the stored value. */
  reasoning_control?: ReasoningControl | null;
  breaker_failure_threshold?: number | null;
  breaker_cooldown_seconds?: number | null;
  input_price_usd_per_million_tokens?: number | null;
  cached_input_price_usd_per_million_tokens?: number | null;
  output_price_usd_per_million_tokens?: number | null;
}

/** A configured model. `id` is the gateway's numeric model key used by routes. */
export interface ProviderModelResponse {
  id: number;
  provider_id: string;
  model_id: string;
  qualified_name: string;
  display_name: string | null;
  is_enabled: boolean;
  default_max_output_tokens: number | null;
  context_window_tokens: number | null;
  max_output_tokens: number | null;
  capabilities: string[];
  /** Reported by the serving machine (local deployments); `false` means the model is unloaded. */
  is_available: boolean;
  /** Called instead of the provider's base URL when set. */
  base_url_override: string | null;
  api_protocol_override: ApiProtocolName | null;
  reasoning_control: ReasoningControl;
  /** `null` uses the gateway-wide breaker setting. */
  breaker_failure_threshold: number | null;
  breaker_cooldown_seconds: number | null;
  input_price_usd_per_million_tokens: number | null;
  cached_input_price_usd_per_million_tokens: number | null;
  output_price_usd_per_million_tokens: number | null;
  created_at: IsoDateTimeString;
  updated_at: IsoDateTimeString;
}

export interface ProviderResponse {
  provider_id: string;
  display_name: string;
  base_url: string;
  api_protocol: ApiProtocolName;
  has_api_key: boolean;
  extra_header_names: string[];
  is_enabled: boolean;
  request_timeout_seconds: number;
  max_concurrent_requests: number;
  models: ProviderModelResponse[];
  created_at: IsoDateTimeString;
  updated_at: IsoDateTimeString;
}

export interface DiscoveredModelResponse {
  model_id: string;
  display_name: string | null;
  already_added: boolean;
}

/** Outcome of a one-off test call (not recorded in request metrics). */
export interface ConnectionTestResponse {
  success: boolean;
  latency_ms: number;
  http_status: number | null;
  message: string;
  response_preview: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}
