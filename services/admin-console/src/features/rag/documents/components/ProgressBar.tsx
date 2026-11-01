import { joinClassNames } from '@/shared/lib/classNames';

/** A thin determinate bar; the caller shows the percentage as text next to it. */
export function ProgressBar({
  percent,
  label,
  isFailed = false,
}: {
  percent: number;
  label: string;
  isFailed?: boolean;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 w-full overflow-hidden rounded-full border border-border bg-surface-raised"
    >
      <div
        className={joinClassNames('h-full transition-[width]', isFailed ? 'bg-critical' : 'bg-working')}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
