import { describe, expect, it } from 'vitest';

import type { ProviderModelResponse } from './api/providerTypes';
import {
  REASONING_CONTROL_CHOICES,
  isReasoningControl,
  modelSettingsValuesFrom,
  toModelUpdateRequest,
  validateModelSettings,
} from './modelSettingsModel';

function aModel(changes: Partial<ProviderModelResponse> = {}): ProviderModelResponse {
  return {
    id: 7,
    provider_id: 'local',
    model_id: 'qwen3-8b',
    qualified_name: 'local/qwen3-8b',
    display_name: null,
    is_enabled: true,
    default_max_output_tokens: null,
    context_window_tokens: null,
    max_output_tokens: null,
    capabilities: [],
    is_available: true,
    base_url_override: null,
    api_protocol_override: null,
    reasoning_control: 'reasoning_effort',
    breaker_failure_threshold: null,
    breaker_cooldown_seconds: null,
    input_price_usd_per_million_tokens: null,
    cached_input_price_usd_per_million_tokens: null,
    output_price_usd_per_million_tokens: null,
    created_at: '2026-10-30T00:00:00Z',
    updated_at: '2026-10-30T00:00:00Z',
    ...changes,
  };
}

describe('reasoning control', () => {
  it('offers both gateway values, the default first', () => {
    expect(REASONING_CONTROL_CHOICES.map((choice) => choice.value)).toEqual(['reasoning_effort', 'enable_thinking']);
  });

  it('recognises only gateway values', () => {
    expect(isReasoningControl('enable_thinking')).toBe(true);
    expect(isReasoningControl('chat_template_kwargs')).toBe(false);
  });

  it('round-trips the stored value into the PATCH body', () => {
    const values = modelSettingsValuesFrom(aModel({ reasoning_control: 'enable_thinking' }));
    expect(values.reasoningControl).toBe('enable_thinking');
    expect(toModelUpdateRequest(values).reasoning_control).toBe('enable_thinking');
  });

  it('sends a changed value', () => {
    const values = { ...modelSettingsValuesFrom(aModel()), reasoningControl: 'enable_thinking' as const };
    expect(toModelUpdateRequest(values).reasoning_control).toBe('enable_thinking');
  });
});

describe('circuit-breaker settings', () => {
  it('sends empty inputs as null (gateway default)', () => {
    const request = toModelUpdateRequest(modelSettingsValuesFrom(aModel()));
    expect(request).toMatchObject({ breaker_failure_threshold: null, breaker_cooldown_seconds: null });
  });

  it('sends typed values as numbers', () => {
    const values = {
      ...modelSettingsValuesFrom(aModel()),
      breakerFailureThreshold: '3',
      breakerCooldownSeconds: '120',
    };
    expect(toModelUpdateRequest(values)).toMatchObject({ breaker_failure_threshold: 3, breaker_cooldown_seconds: 120 });
  });

  it.each([
    ['breakerFailureThreshold', '0', 'breaker_failure_threshold'],
    ['breakerFailureThreshold', '101', 'breaker_failure_threshold'],
    ['breakerCooldownSeconds', '86401', 'breaker_cooldown_seconds'],
    ['breakerCooldownSeconds', '1.5', 'breaker_cooldown_seconds'],
  ])('rejects %s = %s', (inputName, inputValue, fieldName) => {
    const values = { ...modelSettingsValuesFrom(aModel()), [inputName]: inputValue };
    expect(validateModelSettings(values)[fieldName]).toBeDefined();
  });
});
