/** Form values, validation and request bodies for deploying a model and editing a deployment. */
import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { formatInteger } from '@/shared/lib/format';
import { parseOptionalNumber, toOptionalNumberInputValue } from '@/shared/lib/numberInput';

import {
  DEPLOYMENT_NAME_PATTERN,
  MAXIMUM_DEFAULT_TASK_COUNT,
  MAXIMUM_DISPLAY_NAME_LENGTH,
  MAXIMUM_MODEL_ID_LENGTH,
  MAXIMUM_REVISION_LENGTH,
  MAXIMUM_TOKEN_LIMIT,
  MINIMUM_CONTEXT_WINDOW_TOKENS,
  MINIMUM_MAX_OUTPUT_TOKENS,
  MODEL_ID_PATTERN,
  TASK_NAME_PATTERN,
} from './api/localModelTypes';
import type {
  Deployment,
  DeploymentCreateRequest,
  DeploymentUpdateRequest,
  DeviceRequest,
  ModelDtype,
  ReasoningControl,
} from './api/localModelTypes';

/** Backend field names the deployment form can show errors for. */
export const DEPLOYMENT_FORM_FIELD_NAMES = [
  'name',
  'model_id',
  'revision',
  'device',
  'dtype',
  'display_name',
  'context_window_tokens',
  'max_output_tokens',
  'reasoning_control',
  'default_for_tasks',
] as const;

/** Raw values of the deployment form; numbers and the task list stay text until submitted. */
export interface DeploymentFormValues {
  name: string;
  modelId: string;
  revision: string;
  device: DeviceRequest;
  dtype: ModelDtype;
  displayName: string;
  contextWindowTokens: string;
  maxOutputTokens: string;
  reasoningControl: ReasoningControl;
  /** Comma-separated gateway task names. */
  defaultForTasks: string;
}

export function emptyDeploymentFormValues(): DeploymentFormValues {
  return {
    name: '',
    modelId: '',
    revision: '',
    device: 'auto',
    dtype: 'auto',
    displayName: '',
    contextWindowTokens: '',
    maxOutputTokens: '',
    reasoningControl: 'auto',
    defaultForTasks: '',
  };
}

/**
 * Starting values for editing: what the admin configured, not what the service resolved, so an
 * untouched "Auto" or blank field stays automatic after saving.
 */
export function deploymentFormValuesFrom(deployment: Deployment): DeploymentFormValues {
  const { configured } = deployment;
  return {
    name: deployment.name,
    modelId: deployment.model_id,
    revision: configured.revision ?? '',
    device: configured.device,
    dtype: configured.dtype,
    displayName: deployment.display_name ?? '',
    contextWindowTokens: toOptionalNumberInputValue(configured.context_window_tokens),
    maxOutputTokens: toOptionalNumberInputValue(configured.max_output_tokens),
    reasoningControl: configured.reasoning_control,
    defaultForTasks: joinTaskNames(deployment.default_for_tasks),
  };
}

/** "a, b,,c " → ["a", "b", "c"], without duplicates. */
export function parseTaskNames(taskNamesText: string): string[] {
  const taskNames = taskNamesText
    .split(',')
    .map((taskName) => taskName.trim())
    .filter((taskName) => taskName !== '');
  return [...new Set(taskNames)];
}

function joinTaskNames(taskNames: readonly string[]): string {
  return taskNames.join(', ');
}

/** Adds or removes one task name from the comma-separated list. */
export function toggleTaskName(taskNamesText: string, taskName: string): string {
  const taskNames = parseTaskNames(taskNamesText);
  const toggledTaskNames = taskNames.includes(taskName)
    ? taskNames.filter((selectedTaskName) => selectedTaskName !== taskName)
    : [...taskNames, taskName];
  return joinTaskNames(toggledTaskNames);
}

/** Client-side checks mirroring local-llm's request schema; the name is only checked when creating. */
export function validateDeploymentForm(values: DeploymentFormValues, isCreating: boolean): FieldErrorMessages {
  const fieldErrors: FieldErrorMessages = {
    name: isCreating ? validateName(values.name) : undefined,
    model_id: validateModelId(values.modelId),
    revision: validateMaximumLength(values.revision, MAXIMUM_REVISION_LENGTH),
    display_name: validateMaximumLength(values.displayName, MAXIMUM_DISPLAY_NAME_LENGTH),
    context_window_tokens: validateTokenCount(values.contextWindowTokens, MINIMUM_CONTEXT_WINDOW_TOKENS),
    max_output_tokens: validateTokenCount(values.maxOutputTokens, MINIMUM_MAX_OUTPUT_TOKENS),
    default_for_tasks: validateTaskNames(values.defaultForTasks),
  };
  return Object.fromEntries(Object.entries(fieldErrors).filter(([, message]) => message !== undefined));
}

function validateName(name: string): string | undefined {
  if (DEPLOYMENT_NAME_PATTERN.test(name)) return undefined;
  return 'Use 1–128 letters, digits, dots, colons, hyphens or underscores, starting with a letter or digit.';
}

function validateModelId(modelId: string): string | undefined {
  const trimmedModelId = modelId.trim();
  if (trimmedModelId.length > MAXIMUM_MODEL_ID_LENGTH) return `Use at most ${MAXIMUM_MODEL_ID_LENGTH} characters.`;
  if (MODEL_ID_PATTERN.test(trimmedModelId)) return undefined;
  return 'Enter a Hugging Face id as org/repo, or org/repo:QUANT for a GGUF repository.';
}

function validateMaximumLength(text: string, maximumLength: number): string | undefined {
  return text.trim().length > maximumLength ? `Use at most ${maximumLength} characters.` : undefined;
}

function validateTokenCount(inputValue: string, minimumTokens: number): string | undefined {
  const tokenCount = parseOptionalNumber(inputValue);
  if (tokenCount === null) return undefined;
  const isWholeNumberInRange =
    tokenCount !== undefined &&
    Number.isInteger(tokenCount) &&
    tokenCount >= minimumTokens &&
    tokenCount <= MAXIMUM_TOKEN_LIMIT;
  if (isWholeNumberInRange) return undefined;
  return `Enter whole tokens between ${formatInteger(minimumTokens)} and ${formatInteger(MAXIMUM_TOKEN_LIMIT)}, or leave blank.`;
}

function validateTaskNames(taskNamesText: string): string | undefined {
  const taskNames = parseTaskNames(taskNamesText);
  if (taskNames.length > MAXIMUM_DEFAULT_TASK_COUNT) return `Choose at most ${MAXIMUM_DEFAULT_TASK_COUNT} tasks.`;
  const invalidTaskNames = taskNames.filter((taskName) => !TASK_NAME_PATTERN.test(taskName));
  if (invalidTaskNames.length === 0) return undefined;
  return `Not a task name: ${invalidTaskNames.join(', ')}. Task names are lowercase and start with a letter.`;
}

function blankToNull(text: string): string | null {
  return text.trim() || null;
}

/** The parsed value of an optional token field; only call after validation. */
function optionalTokenCount(inputValue: string): number | null {
  return parseOptionalNumber(inputValue) ?? null;
}

export function toDeploymentCreateRequest(values: DeploymentFormValues): DeploymentCreateRequest {
  return {
    name: values.name.trim(),
    model_id: values.modelId.trim(),
    revision: blankToNull(values.revision),
    device: values.device,
    dtype: values.dtype,
    display_name: blankToNull(values.displayName),
    context_window_tokens: optionalTokenCount(values.contextWindowTokens),
    max_output_tokens: optionalTokenCount(values.maxOutputTokens),
    reasoning_control: values.reasoningControl,
    default_for_tasks: parseTaskNames(values.defaultForTasks),
  };
}

/**
 * Only the fields that changed, so untouched settings keep their stored values. A new model id or
 * revision makes the service swap the model.
 */
export function toDeploymentUpdateRequest(
  initialValues: DeploymentFormValues,
  values: DeploymentFormValues,
): DeploymentUpdateRequest {
  const initialRequest = toDeploymentCreateRequest(initialValues);
  const request = toDeploymentCreateRequest(values);
  const changedEntries = Object.entries(request).filter(
    ([fieldName, value]) =>
      fieldName !== 'name' &&
      JSON.stringify(value) !== JSON.stringify(initialRequest[fieldName as keyof DeploymentCreateRequest]),
  );
  return Object.fromEntries(changedEntries);
}

/** A new model id or revision replaces the loaded model. */
export function isModelSwap(request: DeploymentUpdateRequest): boolean {
  return 'model_id' in request || 'revision' in request;
}
