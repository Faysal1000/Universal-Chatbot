import type { ReactNode } from 'react';

import { joinClassNames } from '../lib/classNames';
import { Button } from './Button';
import { PlacardShape, StatePlacard, type PlacardState } from './StatePlacard';

export function ErrorBanner({ message, onRetry, title }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded border border-critical/40 bg-critical/10 px-3.5 py-2.5 text-sm"
    >
      <div className="flex items-start gap-2">
        <PlacardShape state="failed" className="mt-1" />
        <div>
          {title ? <p className="font-medium text-primary">{title}</p> : null}
          <p className="text-secondary">{message}</p>
        </div>
      </div>
      {onRetry ? (
        <Button size="small" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function WarningBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm text-secondary"
    >
      <PlacardShape state="warning" className="mt-1" />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={joinClassNames('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-4 text-sm', className)}>
      <p className="font-medium text-primary">{title}</p>
      {description ? <p className="text-muted">{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export type StatusTone = 'good' | 'critical' | 'warning' | 'neutral';

const TONE_PLACARD_STATES: Record<StatusTone, PlacardState> = {
  good: 'ready',
  critical: 'failed',
  warning: 'warning',
  neutral: 'stopped',
};

/** An outcome in the console's placard vocabulary, for call sites that think in tones. */
export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return <StatePlacard state={TONE_PLACARD_STATES[tone]} label={label} />;
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-border px-1.5 text-xs whitespace-nowrap text-secondary">
      {children}
    </span>
  );
}
