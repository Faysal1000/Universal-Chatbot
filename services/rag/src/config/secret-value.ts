const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Wraps a secret so it cannot leak through logging, JSON serialisation or string
 * interpolation. Call {@link SecretValue.reveal} only where the raw value is needed.
 */
export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** Returns the raw secret. Never log or return the result. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED_PLACEHOLDER;
  }

  toJSON(): string {
    return REDACTED_PLACEHOLDER;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED_PLACEHOLDER;
  }
}
