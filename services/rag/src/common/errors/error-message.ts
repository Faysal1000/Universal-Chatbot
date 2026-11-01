/** The message of an `Error`, or the value itself as text, for logs. */
export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
