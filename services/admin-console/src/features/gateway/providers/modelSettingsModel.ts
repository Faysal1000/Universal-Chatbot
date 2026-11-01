import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { parseOptionalNumber, toOptionalNumberInputValue } from '@/shared/lib/numberInput';

import { VISION_CAPABILITY, hasModelCapability } from './api/modelCapabilities';
import type {
  ApiProtocolName,
  ModelCapability,
  ProviderModelResponse,
  ProviderModelUpdateRequest,
  ReasoningControl,
} from './api/providerTypes';
import { DEFAULT_REASONING_CONTROL } from './api/providerTypes';
import { BASE_URL_PATTERN } from './providerFormModel';

/** Backend field names the model settings form can show errors for. */
export const MODEL_SETTINGS_FIELD_NAMES = [
  'model_id',
  'display_name',
  'default_max_output_tokens',
  'context_window_tokens',
  'max_output_tokens',
  'capabilities',
  'base_url_override',
  'api_protocol_override',
  'reasoning_control',
  'breaker_failure_threshold',
  'breaker_cooldown_seconds',
] as const;

const MAXIMUM_OUTPUT_TOKENS = 1_000_000;
const MAXIMUM_CONTEXT_WINDOW_TOKENS = 10_000_000;
const MAXIMUM_BREAKER_FAILURE_THRESHOLD = 100;
const MAXIMUM_BREAKER_COOLDOWN_SECONDS = 86_400;

export interface ReasoningControlChoice {
  value: ReasoningControl;
  label: string;
}

/** The two ways a caller's `reasoning_effort` can reach a model. */
export const REASONING_CONTROL_CHOICES: readonly ReasoningControlChoice[] = [
  { value: DEFAULT_REASONING_CONTROL, label: 'Send reasoning_effort (hosted APIs)' },
  { value: 'enable_thinking', label: 'Send enable_thinking (Qwen on vLLM or llama.cpp)' },
];

export function isReasoningControl(value: string): value is ReasoningControl {
  return REASONING_CONTROL_CHOICES.some((choice) => choice.value === value);
}

/** Select value meaning "use the provider's protocol". */
export const PROVIDER_PROTOCOL_VALUE = '';

/** Raw values of the model settings form (text inputs stay strings until submit). */
export interface ModelSettingsValues {
  displayName: string;
  defaultMaxOutputTokens: string;
  contextWindowTokens: string;
  maxOutputTokens: string;
  supportsVision: boolean;
  baseUrlOverride: string;
  apiProtocolOverride: ApiProtocolName | typeof PROVIDER_PROTOCOL_VALUE;
  reasoningControl: ReasoningControl;
  /** Empty means "gateway default". */
  breakerFailureThreshold: string;
  /** Empty means "gateway default". */
  breakerCooldownSeconds: string;
}

/** Props shared by the field groups of the model settings form. */
export interface ModelSettingsFieldGroupProps {
  values: ModelSettingsValues;
  fieldErrors: FieldErrorMessages;
  onChange: (changes: Partial<ModelSettingsValues>) => void;
}

export function modelSettingsValuesFrom(model: ProviderModelResponse): ModelSettingsValues {
  return {
    displayName: model.display_name ?? '',
    defaultMaxOutputTokens: toOptionalNumberInputValue(model.default_max_output_tokens),
    contextWindowTokens: toOptionalNumberInputValue(model.context_window_tokens),
    maxOutputTokens: toOptionalNumberInputValue(model.max_output_tokens),
    supportsVision: hasModelCapability(model, VISION_CAPABILITY),
    baseUrlOverride: model.base_url_override ?? '',
    apiProtocolOverride: model.api_protocol_override ?? PROVIDER_PROTOCOL_VALUE,
    reasoningControl: model.reasoning_control,
    breakerFailureThreshold: toOptionalNumberInputValue(model.breaker_failure_threshold),
    breakerCooldownSeconds: toOptionalNumberInputValue(model.breaker_cooldown_seconds),
  };
}

/** Empty, or a whole number from 1 to `maximum`. */
function isValidOptionalCount(value: number | null | undefined, maximum: number): boolean {
  if (value === null) return true;
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= maximum;
}

function validateTokenLimits(values: ModelSettingsValues, fieldErrors: FieldErrorMessages): void {
  const defaultMaxOutputTokens = parseOptionalNumber(values.defaultMaxOutputTokens);
  const maxOutputTokens = parseOptionalNumber(values.maxOutputTokens);
  if (!isValidOptionalCount(defaultMaxOutputTokens, MAXIMUM_OUTPUT_TOKENS)) {
    fieldErrors.default_max_output_tokens = 'Enter a whole number between 1 and 1,000,000, or leave empty.';
  }
  if (!isValidOptionalCount(maxOutputTokens, MAXIMUM_OUTPUT_TOKENS)) {
    fieldErrors.max_output_tokens = 'Enter a whole number between 1 and 1,000,000, or leave empty.';
  }
  if (!isValidOptionalCount(parseOptionalNumber(values.contextWindowTokens), MAXIMUM_CONTEXT_WINDOW_TOKENS)) {
    fieldErrors.context_window_tokens = 'Enter a whole number between 1 and 10,000,000, or leave empty.';
  }
  const isDefaultAboveMaximum =
    typeof defaultMaxOutputTokens === 'number' &&
    typeof maxOutputTokens === 'number' &&
    defaultMaxOutputTokens > maxOutputTokens;
  if (isDefaultAboveMaximum && !fieldErrors.default_max_output_tokens) {
    fieldErrors.default_max_output_tokens = "Must not exceed the model's max output tokens.";
  }
}

function validateBreakerSettings(values: ModelSettingsValues, fieldErrors: FieldErrorMessages): void {
  if (!isValidOptionalCount(parseOptionalNumber(values.breakerFailureThreshold), MAXIMUM_BREAKER_FAILURE_THRESHOLD)) {
    fieldErrors.breaker_failure_threshold = 'Enter a whole number between 1 and 100, or leave empty for the default.';
  }
  if (!isValidOptionalCount(parseOptionalNumber(values.breakerCooldownSeconds), MAXIMUM_BREAKER_COOLDOWN_SECONDS)) {
    fieldErrors.breaker_cooldown_seconds =
      'Enter a whole number of seconds between 1 and 86,400, or leave empty for the default.';
  }
}

/** Client-side checks mirroring the backend limits, keyed by backend field name. */
export function validateModelSettings(values: ModelSettingsValues): FieldErrorMessages {
  const fieldErrors: FieldErrorMessages = {};
  validateTokenLimits(values, fieldErrors);
  const baseUrlOverride = values.baseUrlOverride.trim();
  if (baseUrlOverride && !BASE_URL_PATTERN.test(baseUrlOverride)) {
    fieldErrors.base_url_override = 'Enter an http(s) URL such as http://10.0.0.5:8000/v1, or leave empty.';
  }
  validateBreakerSettings(values, fieldErrors);
  return fieldErrors;
}

function capabilitiesFrom(values: ModelSettingsValues): ModelCapability[] {
  return values.supportsVision ? [VISION_CAPABILITY] : [];
}

/** Builds the PATCH body; empty inputs are sent as `null` so stored values are cleared. */
export function toModelUpdateRequest(values: ModelSettingsValues): ProviderModelUpdateRequest {
  return {
    display_name: values.displayName.trim() || null,
    default_max_output_tokens: parseOptionalNumber(values.defaultMaxOutputTokens) ?? null,
    context_window_tokens: parseOptionalNumber(values.contextWindowTokens) ?? null,
    max_output_tokens: parseOptionalNumber(values.maxOutputTokens) ?? null,
    capabilities: capabilitiesFrom(values),
    base_url_override: values.baseUrlOverride.trim() || null,
    api_protocol_override: values.apiProtocolOverride === PROVIDER_PROTOCOL_VALUE ? null : values.apiProtocolOverride,
    reasoning_control: values.reasoningControl,
    breaker_failure_threshold: parseOptionalNumber(values.breakerFailureThreshold) ?? null,
    breaker_cooldown_seconds: parseOptionalNumber(values.breakerCooldownSeconds) ?? null,
  };
}
