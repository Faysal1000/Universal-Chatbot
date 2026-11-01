/**
 * Splits text into normalised search terms for full-text search, for English and Bengali alike.
 * Word boundaries come from Intl.Segmenter (ICU), which handles Bengali script and
 * conjuncts correctly. No stemming: Bengali stemmers are unreliable, and the dense
 * retriever already covers morphological variation.
 */
const SEGMENTER = new Intl.Segmenter('und', { granularity: 'word' });
const MINIMUM_TERM_LENGTH = 1;
const MAXIMUM_TERM_LENGTH = 64;

/** High-frequency words that carry no retrieval signal. Kept short on purpose. */
// prettier-ignore
const STOP_WORDS = new Set([
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for', 'from', 'has', 'have',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'so', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your',
  // Bengali (particles, postpositions, pronouns, copulas)
  'ও', 'এবং', 'কি', 'কী', 'না', 'যে', 'এই', 'সেই', 'তা', 'তার', 'এর', 'আর', 'বা', 'হয়', 'হয়', 'করে',
  'আমি', 'আমার', 'আপনি', 'আপনার', 'তুমি', 'তোমার', 'জন্য', 'থেকে', 'দিয়ে', 'দিয়ে', 'কে', 'টি', 'টা',
]);

export const LEXICAL_TOKENIZER_VERSION = 'icu-word-nfkc-v1';

export function tokenizeForSearch(text: string): string[] {
  const normalisedText = text.normalize('NFKC').toLocaleLowerCase('en');
  const terms: string[] = [];
  for (const segment of SEGMENTER.segment(normalisedText)) {
    if (segment.isWordLike !== true) continue;
    const term = segment.segment;
    if (term.length < MINIMUM_TERM_LENGTH || term.length > MAXIMUM_TERM_LENGTH) continue;
    if (STOP_WORDS.has(term)) continue;
    terms.push(term);
  }
  return terms;
}
