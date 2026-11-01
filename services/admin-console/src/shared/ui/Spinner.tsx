import { joinClassNames } from '../lib/classNames';

export function Spinner({ size = 'medium', label }: { size?: 'small' | 'medium'; label?: string }) {
  return (
    <span role={label ? 'status' : undefined} className="inline-flex items-center gap-2 text-muted">
      <span
        aria-hidden="true"
        className={joinClassNames(
          'inline-block animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-pulse',
          size === 'small' ? 'size-3.5' : 'size-5',
        )}
      />
      {label ? <span className="text-sm">{label}</span> : null}
    </span>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center p-6">
      <Spinner label={label} />
    </div>
  );
}
