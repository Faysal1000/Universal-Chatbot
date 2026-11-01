import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/api/httpClient';

import { MAX_CHAIN_STEPS } from './api/routingTypes';
import type { TaskRouteResponse } from './api/routingTypes';
import {
  addChainStep,
  canAddChainStep,
  canRemoveChainStep,
  chainErrorsFromApiError,
  chainStepsFrom,
  createChainStep,
  hasChainErrors,
  removeChainStep,
  reorderChainSteps,
  toModelChainRequest,
  validateChainSteps,
} from './chainFormModel';
import type { ChainStepValues } from './chainFormModel';

const allowEveryModel = () => true;

function aStep(modelPk: string, changes: Partial<ChainStepValues> = {}): ChainStepValues {
  return { ...createChainStep(), modelPk, ...changes };
}

function aChainOf(length: number): ChainStepValues[] {
  return Array.from({ length }, (_, index) => aStep(String(index + 1)));
}

function rowKeyAt(steps: readonly ChainStepValues[], index: number): string {
  const step = steps[index];
  if (!step) throw new Error(`The test chain has no step ${index + 1}.`);
  return step.rowKey;
}

function modelPksOf(steps: readonly ChainStepValues[]): string[] {
  return steps.map((step) => step.modelPk);
}

describe('reorderChainSteps', () => {
  it('moves a step down to the position of the step it was dropped on', () => {
    const steps = aChainOf(4);
    const reordered = reorderChainSteps(steps, rowKeyAt(steps, 0), rowKeyAt(steps, 2));
    expect(modelPksOf(reordered)).toEqual(['2', '3', '1', '4']);
  });

  it('moves a step up', () => {
    const steps = aChainOf(4);
    const reordered = reorderChainSteps(steps, rowKeyAt(steps, 3), rowKeyAt(steps, 1));
    expect(modelPksOf(reordered)).toEqual(['1', '4', '2', '3']);
  });

  it('keeps the row keys with their steps', () => {
    const steps = aChainOf(3);
    const reordered = reorderChainSteps(steps, rowKeyAt(steps, 2), rowKeyAt(steps, 0));
    expect(reordered[0]).toBe(steps[2]);
  });

  it('changes nothing for an unknown key or a drop on itself', () => {
    const steps = aChainOf(3);
    expect(modelPksOf(reorderChainSteps(steps, 'missing', rowKeyAt(steps, 0)))).toEqual(['1', '2', '3']);
    expect(modelPksOf(reorderChainSteps(steps, rowKeyAt(steps, 1), rowKeyAt(steps, 1)))).toEqual(['1', '2', '3']);
  });
});

describe('adding and removing steps', () => {
  it('adds an empty step that tries its model once', () => {
    const steps = addChainStep(aChainOf(1));
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ modelPk: '', maxAttempts: '1', timeoutSeconds: '', isEnabled: true });
  });

  it(`stops adding at ${MAX_CHAIN_STEPS} steps`, () => {
    const fullChain = aChainOf(MAX_CHAIN_STEPS);
    expect(canAddChainStep(fullChain)).toBe(false);
    expect(addChainStep(fullChain)).toHaveLength(MAX_CHAIN_STEPS);
    expect(canAddChainStep(aChainOf(MAX_CHAIN_STEPS - 1))).toBe(true);
  });

  it('removes the chosen step', () => {
    const steps = aChainOf(3);
    expect(modelPksOf(removeChainStep(steps, rowKeyAt(steps, 1)))).toEqual(['1', '3']);
  });

  it('never removes the only step', () => {
    const singleStep = aChainOf(1);
    expect(canRemoveChainStep(singleStep)).toBe(false);
    expect(removeChainStep(singleStep, rowKeyAt(singleStep, 0))).toHaveLength(1);
    expect(canRemoveChainStep(aChainOf(2))).toBe(true);
  });
});

describe('chainStepsFrom', () => {
  it('starts a new route with one empty step', () => {
    expect(chainStepsFrom(undefined)).toHaveLength(1);
  });

  it('turns stored defaults (null) into empty inputs', () => {
    const route = {
      steps: [{ position: 1, model_pk: 12, max_attempts: null, timeout_seconds: 30, is_enabled: false }],
    } as TaskRouteResponse;
    expect(chainStepsFrom(route)[0]).toMatchObject({
      modelPk: '12',
      maxAttempts: '',
      timeoutSeconds: '30',
      isEnabled: false,
    });
  });
});

describe('validateChainSteps', () => {
  it('accepts blank attempts and timeout as the defaults', () => {
    const errors = validateChainSteps([aStep('1', { maxAttempts: '', timeoutSeconds: '' })], allowEveryModel);
    expect(hasChainErrors(errors)).toBe(false);
  });

  it.each([
    ['attempts below 1', { maxAttempts: '0' }],
    ['attempts above 10', { maxAttempts: '11' }],
    ['fractional attempts', { maxAttempts: '1.5' }],
    ['a zero timeout', { timeoutSeconds: '0' }],
    ['a timeout above an hour', { timeoutSeconds: '3601' }],
    ['no model', { modelPk: '' }],
  ])('rejects %s', (_, changes) => {
    const step = aStep('1', changes);
    expect(validateChainSteps([step], allowEveryModel).stepErrors[step.rowKey]).toBeDefined();
  });

  it('flags every row of a repeated model', () => {
    const steps = [aStep('7'), aStep('7')];
    expect(Object.keys(validateChainSteps(steps, allowEveryModel).stepErrors)).toHaveLength(2);
  });

  it('flags models the task may not use', () => {
    const step = aStep('3');
    const errors = validateChainSteps([step], (modelPk) => modelPk !== 3);
    expect(errors.stepErrors[step.rowKey]).toMatch(/vision/);
  });

  it('requires at least one step', () => {
    expect(validateChainSteps([], allowEveryModel).chainError).toBe('Add at least one step.');
  });
});

describe('toModelChainRequest', () => {
  it('serialises the steps in list order and sends blanks as null', () => {
    const steps = [
      aStep('12', { maxAttempts: '2', timeoutSeconds: '30' }),
      aStep('7', { maxAttempts: '', timeoutSeconds: '', isEnabled: false }),
    ];
    expect(toModelChainRequest(steps, true)).toEqual({
      steps: [
        { model_pk: 12, max_attempts: 2, timeout_seconds: 30, is_enabled: true },
        { model_pk: 7, max_attempts: null, timeout_seconds: null, is_enabled: false },
      ],
      append_default_model: true,
    });
  });

  it('follows a reorder', () => {
    const steps = aChainOf(2);
    const request = toModelChainRequest(reorderChainSteps(steps, rowKeyAt(steps, 1), rowKeyAt(steps, 0)), false);
    expect(request.steps.map((step) => step.model_pk)).toEqual([2, 1]);
  });
});

describe('chainErrorsFromApiError', () => {
  function validationError(loc: (string | number)[], msg: string): ApiError {
    return new ApiError(422, msg, { validationErrors: [{ loc, msg }] });
  }

  it('places a step error on the row it is about', () => {
    const steps = aChainOf(3);
    const errors = chainErrorsFromApiError(
      validationError(['body', 'steps', 1, 'max_attempts'], 'Input should be less than or equal to 10'),
      steps,
    );
    expect(errors?.stepErrors[rowKeyAt(steps, 1)]).toBe('Input should be less than or equal to 10');
  });

  it('shows chain-wide messages without the validator prefix', () => {
    const errors = chainErrorsFromApiError(
      validationError(['body', 'steps'], 'Value error, models appear more than once: 7'),
      aChainOf(2),
    );
    expect(errors?.chainError).toBe('models appear more than once: 7');
  });

  it('shows a 422 without field locations (vision rule) on the chain', () => {
    const errors = chainErrorsFromApiError(new ApiError(422, 'Task requires vision'), aChainOf(1));
    expect(errors).toEqual({ stepErrors: {}, chainError: 'Task requires vision' });
  });

  it('ignores other errors', () => {
    expect(chainErrorsFromApiError(new ApiError(404, 'Unknown model'), aChainOf(1))).toBeNull();
    expect(chainErrorsFromApiError(new Error('offline'), aChainOf(1))).toBeNull();
  });
});
