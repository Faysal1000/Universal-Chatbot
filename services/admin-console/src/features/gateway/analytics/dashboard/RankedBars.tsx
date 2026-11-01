import { EmptyState } from '@/shared/ui/StatusMessages';

import type { RankedBarItem } from './dashboardModel';

/** A top-N list drawn as horizontal bars scaled to the largest value. */
export function RankedBars({
  items,
  formatValue,
  color,
  emptyTitle,
}: {
  items: readonly RankedBarItem[];
  formatValue: (value: number) => string;
  color: string;
  emptyTitle: string;
}) {
  if (items.length === 0) return <EmptyState title={emptyTitle} />;
  const largestValue = Math.max(...items.map((item) => item.value), 1);
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-mono text-xs text-primary" title={item.label}>
              {item.label}
            </span>
            <span className="tabular shrink-0 text-secondary">
              {formatValue(item.value)}
              {item.note ? <span className="ml-2 text-xs text-muted">{item.note}</span> : null}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-hover" aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{ width: `${(item.value / largestValue) * 100}%`, backgroundColor: color }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
