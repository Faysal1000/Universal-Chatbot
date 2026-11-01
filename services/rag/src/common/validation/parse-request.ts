import type { z } from 'zod';

import { ApplicationError } from '../errors/application-error.js';
import type { ProblemFieldError } from '../errors/problem-details.js';

/**
 * Validates untrusted input (body, query, params) against a zod schema. Failures become
 * 422 `validation_failed` with one entry per offending field, as the clients expect.
 */
export function parseRequest<Schema extends z.ZodType>(schema: Schema, input: unknown): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ApplicationError(422, 'validation_failed', 'The request is invalid.', {
    fieldErrors: toFieldErrors(result.error),
  });
}

function toFieldErrors(validationError: z.ZodError): ProblemFieldError[] {
  return validationError.issues.map((issue) => ({
    field: issue.path.length === 0 ? '(body)' : issue.path.join('.'),
    message: issue.message,
  }));
}
