import { Tiktoken } from 'js-tiktoken/lite';
import o200kBase from 'js-tiktoken/ranks/o200k_base';

/**
 * Estimates how many tokens a model will see for some text. The serving model's tokenizer
 * is unknown (the gateway may route to any model), so text is counted with OpenAI's
 * o200k_base and multiplied by a safety factor. o200k is a reasonable middle ground
 * across modern tokenizers, including for Bengali, which older vocabularies split into
 * far more pieces.
 */
export class TokenEstimator {
  private static sharedEncoder: Tiktoken | undefined;

  constructor(private readonly safetyFactor: number) {
    if (safetyFactor < 1) throw new RangeError('The safety factor must be at least 1');
  }

  estimate(text: string): number {
    if (text === '') return 0;
    return Math.ceil(this.countBaseTokens(text) * this.safetyFactor);
  }

  /** Tokens a chat message costs: its content plus per-message framing (role markers). */
  estimateMessage(content: string): number {
    return this.estimate(content) + MESSAGE_FRAMING_TOKENS;
  }

  /** Cuts text to at most `maximumTokens` estimated tokens, on a token boundary. */
  truncate(text: string, maximumTokens: number): string {
    const baseTokenBudget = Math.floor(maximumTokens / this.safetyFactor);
    const encoder = TokenEstimator.encoder();
    const tokens = encoder.encode(text);
    if (tokens.length <= baseTokenBudget) return text;
    // A cut inside a multi-byte character decodes to U+FFFD; drop that fragment.
    return encoder.decode(tokens.slice(0, Math.max(0, baseTokenBudget))).replace(/\uFFFD+$/u, '');
  }

  private countBaseTokens(text: string): number {
    return TokenEstimator.encoder().encode(text).length;
  }

  /** The ranks table is several MB; one encoder is shared by the whole process. */
  private static encoder(): Tiktoken {
    TokenEstimator.sharedEncoder ??= new Tiktoken(o200kBase);
    return TokenEstimator.sharedEncoder;
  }
}

/** Chat formats wrap each message in role and separator tokens (about 4 in practice). */
export const MESSAGE_FRAMING_TOKENS = 4;
