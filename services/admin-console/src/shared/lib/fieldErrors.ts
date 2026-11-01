import { ApiError } from '../api/httpClient';

/** Field name → message, for inline form errors. */
export type FieldErrorMessages = Partial<Record<string, string>>;

export interface SplitApiError {
  fieldErrors: FieldErrorMessages;
  /** Message for a banner/toast; `null` when every error maps to a known field. */
  generalMessage: string | null;
}

/**
 * Splits an API error into inline field errors (422 entries whose `loc` names one of
 * `knownFieldNames`) and a general message for everything else.
 * `loc` looks like `["body", "base_url"]` or `["body", "extra_headers", 0, "name"]`;
 * nested locations map to their top-level field.
 */
export function splitApiError(error: unknown, knownFieldNames: readonly string[]): SplitApiError {
  if (!(error instanceof ApiError)) {
    return { fieldErrors: {}, generalMessage: error instanceof Error ? error.message : 'Something went wrong.' };
  }
  if (error.validationErrors.length === 0) return { fieldErrors: {}, generalMessage: error.message };

  const fieldErrors: FieldErrorMessages = {};
  const unmatchedMessages: string[] = [];
  for (const validationError of error.validationErrors) {
    const locationWithoutBody = validationError.loc.filter((locationPart) => locationPart !== 'body');
    const topLevelFieldName = locationWithoutBody[0];
    if (typeof topLevelFieldName === 'string' && knownFieldNames.includes(topLevelFieldName)) {
      const message = cleanValidationMessage(validationError.msg);
      fieldErrors[topLevelFieldName] = fieldErrors[topLevelFieldName]
        ? `${fieldErrors[topLevelFieldName]}; ${message}`
        : message;
    } else {
      const fieldPath = locationWithoutBody.join('.');
      unmatchedMessages.push(fieldPath ? `${fieldPath}: ${validationError.msg}` : validationError.msg);
    }
  }
  return { fieldErrors, generalMessage: unmatchedMessages.length > 0 ? unmatchedMessages.join('; ') : null };
}

/** Pydantic prefixes custom validator messages with "Value error, ". */
function cleanValidationMessage(message: string): string {
  return message.replace(/^Value error,\s*/i, '');
}
