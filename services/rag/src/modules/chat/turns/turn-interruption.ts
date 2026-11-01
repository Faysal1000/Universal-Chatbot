/** Why a running turn stopped early; passed as the abort reason of its signal. */
export type TurnInterruption =
  | { readonly kind: 'cancelled' }
  /** No client has been connected for the disconnect grace period. */
  | { readonly kind: 'abandoned' }
  | { readonly kind: 'superseded'; readonly supersededByTurnId: string };

export class TurnInterruptedError extends Error {
  constructor(readonly interruption: TurnInterruption) {
    super(`Turn ${interruption.kind}`);
    this.name = 'TurnInterruptedError';
  }
}

export function interruptionOf(abortSignal: AbortSignal): TurnInterruption | undefined {
  const reason: unknown = abortSignal.reason;
  return typeof reason === 'object' && reason !== null && 'kind' in reason
    ? (reason as TurnInterruption)
    : undefined;
}
