/** The same rule as rag's ids: version 1–8, RFC 4122 variant. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Whether the text, ignoring surrounding whitespace, is a UUID. */
export function isUuid(text: string): boolean {
  return UUID_PATTERN.test(text.trim());
}
