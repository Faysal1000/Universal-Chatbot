import { tokenizeForSearch } from './lexical-tokenizer.js';

/** Postgres limits on tsvector positions. */
const MAXIMUM_POSITION = 16_383;
const MAXIMUM_POSITIONS_PER_TERM = 256;

/** A tsvector literal with each term's positions, so ranking sees term frequency. */
export function toSearchDocument(text: string): string {
  const positionsByTerm = new Map<string, number[]>();
  tokenizeForSearch(text).forEach((term, index) => {
    const positions = positionsByTerm.get(term) ?? [];
    if (positions.length < MAXIMUM_POSITIONS_PER_TERM) positions.push(Math.min(index + 1, MAXIMUM_POSITION));
    positionsByTerm.set(term, positions);
  });
  return [...positionsByTerm]
    .map(([term, positions]) => `${quoteLexeme(term)}:${positions.join(',')}`)
    .join(' ');
}

/** A tsquery literal matching any of the text's terms, or undefined when it has none. */
export function toSearchQuery(text: string): string | undefined {
  const terms = [...new Set(tokenizeForSearch(text))];
  return terms.length === 0 ? undefined : terms.map(quoteLexeme).join(' | ');
}

function quoteLexeme(term: string): string {
  return `'${term.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
}
