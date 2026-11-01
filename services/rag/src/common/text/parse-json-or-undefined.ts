/** Parses JSON text, or returns undefined when it is not valid JSON. */
export function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
