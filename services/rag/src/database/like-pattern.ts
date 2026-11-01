/** Escapes `%`, `_` and `\` so user input matches literally inside a LIKE pattern. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
