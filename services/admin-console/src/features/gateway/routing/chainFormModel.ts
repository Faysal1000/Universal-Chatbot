import { ApiError } from '@/shared/api/httpClient';
import { parseOptionalNumber, toOptionalNumberInputValue } from '@/shared/lib/numberInput';

import {
  MAX_CHAIN_STEPS,
  MAX_STEP_ATTEMPTS,
  MAX_STEP_TIMEOUT_SECONDS,
  MIN_CHAIN_STEPS,
  MIN_STEP_ATTEMPTS,
} from './api/routingTypes';
import type { ChainStepRequest, ModelChainRequest, TaskRouteResponse } from './api/routingTypes';

/** Raw values of one chain step row (inputs stay strings until submit). */
export interface ChainStepValues {
  /** Stable key for React and drag-and-drop; rows move, so the index cannot be the key. */
  rowKey: string;
  modelPk: string;
  /** Empty means "gateway default attempts". */
  maxAttempts: string;
  /** Empty means "the provider's timeout". */
  timeoutSeconds: string;
  isEnabled: boolean;
}

/** Validation messages per step row, by row key, plus one for the chain as a whole. */
export interface ChainValidationErrors {
  stepErrors: Record<string, string>;
  chainError: string | null;
}

export const NO_CHAIN_ERRORS: ChainValidationErrors = { stepErrors: {}, chainError: null };

/** The gateway's default for new steps: move on quickly, the chain itself is the retry. */
const NEW_STEP_MAX_ATTEMPTS = '1';
const UNPROCESSABLE_CONTENT_STATUS = 422;
const CHAIN_FIELD_NAMES: ReadonlySet<string | number> = new Set(['steps', 'append_default_model']);

let nextRowNumber = 0;

function createRowKey(): string {
  nextRowNumber += 1;
  return `chain-step-${nextRowNumber}`;
}

export function createChainStep(): ChainStepValues {
  return {
    rowKey: createRowKey(),
    modelPk: '',
    maxAttempts: NEW_STEP_MAX_ATTEMPTS,
    timeoutSeconds: '',
    isEnabled: true,
  };
}

export function chainStepsFrom(route: TaskRouteResponse | undefined): ChainStepValues[] {
  if (!route) return [createChainStep()];
  return route.steps.map((step) => ({
    rowKey: createRowKey(),
    modelPk: String(step.model_pk),
    maxAttempts: toOptionalNumberInputValue(step.max_attempts),
    timeoutSeconds: toOptionalNumberInputValue(step.timeout_seconds),
    isEnabled: step.is_enabled,
  }));
}

export function canAddChainStep(steps: readonly ChainStepValues[]): boolean {
  return steps.length < MAX_CHAIN_STEPS;
}

export function canRemoveChainStep(steps: readonly ChainStepValues[]): boolean {
  return steps.length > MIN_CHAIN_STEPS;
}

/** Appends an empty step; unchanged when the chain is already full. */
export function addChainStep(steps: readonly ChainStepValues[]): ChainStepValues[] {
  return canAddChainStep(steps) ? [...steps, createChainStep()] : [...steps];
}

/** Removes the step with `rowKey`; unchanged when it is the only step. */
export function removeChainStep(steps: readonly ChainStepValues[], rowKey: string): ChainStepValues[] {
  return canRemoveChainStep(steps) ? steps.filter((step) => step.rowKey !== rowKey) : [...steps];
}

export function updateChainStep(
  steps: readonly ChainStepValues[],
  rowKey: string,
  changes: Partial<Omit<ChainStepValues, 'rowKey'>>,
): ChainStepValues[] {
  return steps.map((step) => (step.rowKey === rowKey ? { ...step, ...changes } : step));
}

/** Moves the step `movedRowKey` to where `targetRowKey` is (the drop of a drag); unknown keys change nothing. */
export function reorderChainSteps(
  steps: readonly ChainStepValues[],
  movedRowKey: string,
  targetRowKey: string,
): ChainStepValues[] {
  const fromIndex = steps.findIndex((step) => step.rowKey === movedRowKey);
  const toIndex = steps.findIndex((step) => step.rowKey === targetRowKey);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [...steps];
  const reorderedSteps = [...steps];
  const [movedStep] = reorderedSteps.splice(fromIndex, 1);
  if (movedStep) reorderedSteps.splice(toIndex, 0, movedStep);
  return reorderedSteps;
}

/** 1-based position of a step, or `undefined` when the key is unknown. */
export function chainStepPosition(steps: readonly ChainStepValues[], rowKey: string): number | undefined {
  const index = steps.findIndex((step) => step.rowKey === rowKey);
  return index < 0 ? undefined : index + 1;
}

function isWholeNumberInRange(value: number | null | undefined, minimum: number, maximum: number): boolean {
  return value === null || (value !== undefined && Number.isInteger(value) && value >= minimum && value <= maximum);
}

function isTimeoutInRange(value: number | null | undefined): boolean {
  return value === null || (value !== undefined && value > 0 && value <= MAX_STEP_TIMEOUT_SECONDS);
}

function describeStepProblem(
  step: ChainStepValues,
  duplicateModelPks: ReadonlySet<string>,
  isModelAllowed: (modelPk: number) => boolean,
): string | null {
  if (!step.modelPk) return 'Choose a model.';
  if (duplicateModelPks.has(step.modelPk)) return 'Each model may appear only once in a chain.';
  if (!isModelAllowed(Number(step.modelPk))) {
    return 'This task requires vision; choose a model with the Vision capability.';
  }
  if (!isWholeNumberInRange(parseOptionalNumber(step.maxAttempts), MIN_STEP_ATTEMPTS, MAX_STEP_ATTEMPTS)) {
    return `Attempts must be a whole number from ${MIN_STEP_ATTEMPTS} to ${MAX_STEP_ATTEMPTS}, or empty for the gateway default.`;
  }
  if (!isTimeoutInRange(parseOptionalNumber(step.timeoutSeconds))) {
    return `Timeout must be above 0 and at most ${MAX_STEP_TIMEOUT_SECONDS} seconds, or empty for the provider's timeout.`;
  }
  return null;
}

function findDuplicateModelPks(steps: readonly ChainStepValues[]): Set<string> {
  const seenModelPks = new Set<string>();
  const duplicateModelPks = new Set<string>();
  for (const step of steps) {
    if (step.modelPk && seenModelPks.has(step.modelPk)) duplicateModelPks.add(step.modelPk);
    seenModelPks.add(step.modelPk);
  }
  return duplicateModelPks;
}

function describeChainLengthProblem(stepCount: number): string | null {
  if (stepCount < MIN_CHAIN_STEPS) return 'Add at least one step.';
  if (stepCount > MAX_CHAIN_STEPS) return `Use at most ${MAX_CHAIN_STEPS} steps.`;
  return null;
}

/** Client-side checks mirroring the gateway: 1–10 steps, unique models, ranges, vision rule. */
export function validateChainSteps(
  steps: readonly ChainStepValues[],
  isModelAllowed: (modelPk: number) => boolean,
): ChainValidationErrors {
  const duplicateModelPks = findDuplicateModelPks(steps);
  const stepErrors: Record<string, string> = {};
  for (const step of steps) {
    const problem = describeStepProblem(step, duplicateModelPks, isModelAllowed);
    if (problem) stepErrors[step.rowKey] = problem;
  }
  return { stepErrors, chainError: describeChainLengthProblem(steps.length) };
}

export function hasChainErrors(errors: ChainValidationErrors): boolean {
  return errors.chainError !== null || Object.keys(errors.stepErrors).length > 0;
}

/** Pydantic prefixes custom validator messages with "Value error, ". */
function withoutValidatorPrefix(message: string): string {
  return message.replace(/^Value error,\s*/i, '');
}

function joinMessages(existingMessage: string | undefined, message: string): string {
  return existingMessage ? `${existingMessage}; ${message}` : message;
}

/**
 * Places the gateway's 422 messages next to what they are about: `["body", "steps", 2, "max_attempts"]`
 * goes to the third row, anything else about the chain (a repeated model, a text-only model on a vision
 * task) to the chain. Returns `null` for other errors, which the caller shows as a banner.
 * Messages about other fields (task name, description) are left to the caller.
 */
export function chainErrorsFromApiError(
  error: unknown,
  steps: readonly ChainStepValues[],
): ChainValidationErrors | null {
  if (!(error instanceof ApiError) || error.httpStatus !== UNPROCESSABLE_CONTENT_STATUS) return null;
  if (error.validationErrors.length === 0) return { stepErrors: {}, chainError: error.message };

  const stepErrors: Record<string, string> = {};
  let chainError: string | null = null;
  for (const validationError of error.validationErrors) {
    const [fieldName, stepIndex] = validationError.loc.filter((locationPart) => locationPart !== 'body');
    if (fieldName === undefined || !CHAIN_FIELD_NAMES.has(fieldName)) continue;
    const message = withoutValidatorPrefix(validationError.msg);
    const row = typeof stepIndex === 'number' ? steps[stepIndex] : undefined;
    if (row) stepErrors[row.rowKey] = joinMessages(stepErrors[row.rowKey], message);
    else chainError = joinMessages(chainError ?? undefined, message);
  }
  return { stepErrors, chainError };
}

function toChainStepRequest(step: ChainStepValues): ChainStepRequest {
  return {
    model_pk: Number(step.modelPk),
    max_attempts: parseOptionalNumber(step.maxAttempts) ?? null,
    timeout_seconds: parseOptionalNumber(step.timeoutSeconds) ?? null,
    is_enabled: step.isEnabled,
  };
}

/** The `PUT /routes/{task}/chain` body; steps keep their list order, blanks become `null` (the defaults). */
export function toModelChainRequest(steps: readonly ChainStepValues[], appendDefaultModel: boolean): ModelChainRequest {
  return { steps: steps.map(toChainStepRequest), append_default_model: appendDefaultModel };
}
