import { describe, expect, it } from 'vitest';

import type { Deployment } from './api/localModelTypes';
import {
  deploymentFormValuesFrom,
  emptyDeploymentFormValues,
  isModelSwap,
  parseTaskNames,
  toDeploymentCreateRequest,
  toDeploymentUpdateRequest,
  toggleTaskName,
  validateDeploymentForm,
} from './deploymentFormModel';
import type { DeploymentFormValues } from './deploymentFormModel';

function aFilledForm(overrides: Partial<DeploymentFormValues> = {}): DeploymentFormValues {
  return {
    ...emptyDeploymentFormValues(),
    name: 'qwen3.5-0.8b',
    modelId: 'unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M',
    ...overrides,
  };
}

const existingDeployment = {
  name: 'qwen3.5-0.8b',
  display_name: 'Qwen',
  model_id: 'unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M',
  revision: null,
  device: 'auto',
  dtype: null,
  context_window_tokens: 8192,
  max_output_tokens: 2048,
  reasoning_control: 'enable_thinking',
  configured: {
    revision: null,
    device: 'auto',
    dtype: 'auto',
    context_window_tokens: null,
    max_output_tokens: null,
    reasoning_control: 'auto',
  },
  default_for_tasks: ['query_rewrite'],
} as unknown as Deployment;

describe('validateDeploymentForm', () => {
  it('accepts a minimal deployment', () => {
    expect(validateDeploymentForm(aFilledForm(), true)).toEqual({});
  });

  it.each(['', '-qwen', 'has space', 'a'.repeat(129)])('rejects the name %j', (name) => {
    expect(validateDeploymentForm(aFilledForm({ name }), true).name).toBeDefined();
  });

  it('accepts names with capitals, dots and colons as the service does', () => {
    expect(validateDeploymentForm(aFilledForm({ name: 'Qwen3.5:q4_k-m' }), true)).toEqual({});
  });

  it('skips the name check when editing', () => {
    expect(validateDeploymentForm(aFilledForm({ name: '' }), false).name).toBeUndefined();
  });

  it.each(['qwen', 'org/', 'org/repo:', 'https://huggingface.co/org/repo'])('rejects the model id %j', (modelId) => {
    expect(validateDeploymentForm(aFilledForm({ modelId }), true).model_id).toBeDefined();
  });

  it('accepts safetensors and GGUF model ids', () => {
    expect(validateDeploymentForm(aFilledForm({ modelId: 'Qwen/Qwen3.5-0.8B' }), true)).toEqual({});
  });

  it('checks token limits', () => {
    const fieldErrors = validateDeploymentForm(
      aFilledForm({ contextWindowTokens: '128', maxOutputTokens: '1.5' }),
      true,
    );
    expect(fieldErrors.context_window_tokens).toBeDefined();
    expect(fieldErrors.max_output_tokens).toBeDefined();
  });

  it('rejects task names the gateway would not accept', () => {
    expect(
      validateDeploymentForm(aFilledForm({ defaultForTasks: 'query_rewrite, Bad Task' }), true).default_for_tasks,
    ).toBe('Not a task name: Bad Task. Task names are lowercase and start with a letter.');
  });
});

describe('toDeploymentCreateRequest', () => {
  it('trims text, turns blanks into null and parses numbers and tasks', () => {
    const values = aFilledForm({
      name: ' qwen ',
      revision: ' ',
      displayName: 'Qwen 0.8B',
      contextWindowTokens: '8192',
      defaultForTasks: 'query_rewrite, ,summarisation, query_rewrite',
      device: 'cpu',
    });
    expect(toDeploymentCreateRequest(values)).toEqual({
      name: 'qwen',
      model_id: 'unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M',
      revision: null,
      device: 'cpu',
      dtype: 'auto',
      display_name: 'Qwen 0.8B',
      context_window_tokens: 8192,
      max_output_tokens: null,
      reasoning_control: 'auto',
      default_for_tasks: ['query_rewrite', 'summarisation'],
    });
  });
});

describe('deploymentFormValuesFrom', () => {
  it('starts from the configured settings, not the resolved ones', () => {
    expect(deploymentFormValuesFrom(existingDeployment)).toMatchObject({
      contextWindowTokens: '',
      maxOutputTokens: '',
      dtype: 'auto',
      reasoningControl: 'auto',
    });
  });
});

describe('toDeploymentUpdateRequest', () => {
  const initialValues = deploymentFormValuesFrom(existingDeployment);

  it('sends nothing when nothing changed', () => {
    expect(toDeploymentUpdateRequest(initialValues, initialValues)).toEqual({});
  });

  it('sends only the changed settings', () => {
    const values = { ...initialValues, displayName: '', device: 'gpu' as const, maxOutputTokens: '1024' };
    expect(toDeploymentUpdateRequest(initialValues, values)).toEqual({
      display_name: null,
      device: 'gpu',
      max_output_tokens: 1024,
    });
  });

  it('sends a reasoning control change without flagging a model swap', () => {
    const request = toDeploymentUpdateRequest(initialValues, {
      ...initialValues,
      reasoningControl: 'reasoning_effort',
    });
    expect(request).toEqual({ reasoning_control: 'reasoning_effort' });
    expect(isModelSwap(request)).toBe(false);
  });

  it('flags a new revision as a model swap', () => {
    const request = toDeploymentUpdateRequest(initialValues, { ...initialValues, revision: 'abc123' });
    expect(request).toEqual({ revision: 'abc123' });
    expect(isModelSwap(request)).toBe(true);
    expect(isModelSwap({ device: 'cpu' })).toBe(false);
  });
});

describe('task name list', () => {
  it('parses a comma list without blanks or duplicates', () => {
    expect(parseTaskNames(' a, b,,a ')).toEqual(['a', 'b']);
  });

  it('toggles one task in and out', () => {
    expect(toggleTaskName('a, b', 'c')).toBe('a, b, c');
    expect(toggleTaskName('a, b', 'a')).toBe('b');
  });
});
