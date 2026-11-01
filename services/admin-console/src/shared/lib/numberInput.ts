/** Parses an optional numeric text input: empty → `null`, invalid → `undefined`. */
export function parseOptionalNumber(inputValue: string): number | null | undefined {
  const trimmedValue = inputValue.trim();
  if (trimmedValue === '') return null;
  const parsedValue = Number(trimmedValue);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

/** Renders an optional number into a text input value. */
export function toOptionalNumberInputValue(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}
