import { joinClassNames } from '../lib/classNames';

/**
 * The console's one state vocabulary. Shape carries the meaning, colour repeats it, so the
 * state reads in greyscale and for colour-blind operators:
 * ready = filled square, working = half-filled square, stopped = dashed outline,
 * disabled = struck outline, warning = filled triangle, failed = filled diamond, unknown = ring.
 */
export type PlacardState = 'ready' | 'working' | 'stopped' | 'disabled' | 'warning' | 'failed' | 'unknown';

const STATE_COLOR_CLASS: Record<PlacardState, string> = {
  ready: 'text-good',
  working: 'text-working',
  stopped: 'text-idle',
  disabled: 'text-idle',
  warning: 'text-warning',
  failed: 'text-critical',
  unknown: 'text-idle',
};

export function PlacardShape({ state, className }: { state: PlacardState; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={joinClassNames('size-3 shrink-0', STATE_COLOR_CLASS[state], className)}
    >
      {state === 'ready' ? <rect x="1" y="1" width="10" height="10" fill="currentColor" /> : null}
      {state === 'working' ? (
        <>
          <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1.5 10.5 L10.5 1.5 L10.5 10.5 Z" fill="currentColor" />
        </>
      ) : null}
      {state === 'stopped' ? (
        <rect
          x="1.5"
          y="1.5"
          width="9"
          height="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeDasharray="2 1.6"
        />
      ) : null}
      {state === 'disabled' ? (
        <>
          <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1.5 10.5 L10.5 1.5" stroke="currentColor" strokeWidth="1.2" />
        </>
      ) : null}
      {state === 'warning' ? <path d="M6 1 L11.5 11 L0.5 11 Z" fill="currentColor" /> : null}
      {state === 'failed' ? <path d="M6 0.5 L11.5 6 L6 11.5 L0.5 6 Z" fill="currentColor" /> : null}
      {state === 'unknown' ? (
        <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      ) : null}
    </svg>
  );
}

/** Shape plus a text label; the label is the accessible name, never colour alone. */
export function StatePlacard({ state, label, className }: { state: PlacardState; label: string; className?: string }) {
  return (
    <span className={joinClassNames('inline-flex items-center gap-1.5 text-sm whitespace-nowrap', className)}>
      <PlacardShape state={state} />
      <span className="text-primary">{label}</span>
    </span>
  );
}
