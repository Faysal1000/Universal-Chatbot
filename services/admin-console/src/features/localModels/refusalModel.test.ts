import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/api/httpClient';

import { describeInsufficientMemory, describeRefusal } from './refusalModel';

const GIBIBYTE = 1024 ** 3;

function aProblem(httpStatus: number, code: string, message: string, details?: unknown): ApiError {
  return new ApiError(httpStatus, message, { code, details });
}

describe('describeInsufficientMemory', () => {
  it('states required and free memory for one device', () => {
    const details = { required_bytes: { cpu: 4.1 * GIBIBYTE }, free_bytes: { cpu: 2.3 * GIBIBYTE } };
    expect(describeInsufficientMemory(details)).toMatch(/^Not enough memory on CPU: needs 4\.1 GB, 2\.3 GB free\. /);
  });

  it('lists every device that was tried', () => {
    const details = {
      required_bytes: { cuda: 6 * GIBIBYTE, cpu: 12 * GIBIBYTE },
      free_bytes: { cuda: 2 * GIBIBYTE, cpu: 8 * GIBIBYTE },
    };
    expect(describeInsufficientMemory(details)).toMatch(
      /^Not enough memory on GPU: needs 6 GB, 2 GB free; on CPU: needs 12 GB, 8 GB free\./,
    );
  });

  it('returns undefined for details it does not recognise', () => {
    expect(describeInsufficientMemory({ required_bytes: 'lots' })).toBeUndefined();
    expect(describeInsufficientMemory(undefined)).toBeUndefined();
  });
});

describe('describeRefusal', () => {
  it('turns insufficient_memory into a sentence with sizes', () => {
    const error = aProblem(409, 'insufficient_memory', 'Conflict: Not enough memory: cpu needs about 4198 MiB', {
      required_bytes: { cpu: 4.1 * GIBIBYTE },
      free_bytes: { cpu: 2.3 * GIBIBYTE },
    });
    expect(describeRefusal(error).message).toContain('Not enough memory on CPU: needs 4.1 GB, 2.3 GB free.');
    expect(describeRefusal(error).fieldName).toBeUndefined();
  });

  it('falls back to the service sentence when insufficient_memory has no details', () => {
    const error = aProblem(409, 'insufficient_memory', 'Conflict: Not enough memory to load this model');
    expect(describeRefusal(error).message).toBe('Not enough memory to load this model');
  });

  it('attaches an unsupported model to the model id field', () => {
    const error = aProblem(
      422,
      'unsupported_model',
      "Unprocessable Entity: Hugging Face repository 'a/b' was not found",
    );
    expect(describeRefusal(error)).toEqual({
      message: "This model cannot run on local-llm: Hugging Face repository 'a/b' was not found.",
      fieldName: 'model_id',
    });
  });

  it('attaches untrusted remote code to the model id field', () => {
    const error = aProblem(
      422,
      'untrusted_remote_code',
      "Unprocessable Entity: 'acme/m' executes its own Python code on load; add 'acme' to LOCAL_LLM_TRUSTED_CODE_ORGANIZATIONS to allow it",
    );
    expect(describeRefusal(error)).toEqual({
      message:
        "'acme/m' executes its own Python code on load; add 'acme' to LOCAL_LLM_TRUSTED_CODE_ORGANIZATIONS to allow it.",
      fieldName: 'model_id',
    });
  });

  it('attaches gpu_unavailable to the device field', () => {
    const error = aProblem(
      422,
      'gpu_unavailable',
      'Unprocessable Entity: No usable GPU is available for this deployment',
    );
    expect(describeRefusal(error).fieldName).toBe('device');
  });

  it('attaches a duplicate name to the name field', () => {
    const error = aProblem(409, 'deployment_name_taken', "Conflict: A deployment named 'qwen' already exists");
    expect(describeRefusal(error)).toEqual({
      message: "A deployment named 'qwen' already exists. Choose another name.",
      fieldName: 'name',
    });
  });

  it('keeps a busy deployment at page level, whatever its wording', () => {
    const error = aProblem(409, 'deployment_conflict', "Conflict: A deployment named 'qwen' already exists");
    expect(describeRefusal(error).fieldName).toBeUndefined();
  });

  it('keeps other conflicts at page level', () => {
    const error = aProblem(409, 'deployment_conflict', "Conflict: Deployment 'qwen' is busy; retry when it is ready");
    expect(describeRefusal(error)).toEqual({ message: "Deployment 'qwen' is busy; retry when it is ready" });
  });

  it('passes through errors without a known code', () => {
    expect(describeRefusal(new ApiError(502, 'The service behind this page is not reachable.')).message).toBe(
      'The service behind this page is not reachable.',
    );
    expect(describeRefusal(new Error('boom')).message).toBe('boom');
  });
});
