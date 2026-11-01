import type { ReactNode } from 'react';

import { joinClassNames } from '../lib/classNames';

export interface ManifestField {
  label: string;
  value: ReactNode;
  /** Extra line under the value (unit, comparison, timestamp). */
  note?: ReactNode;
}

/**
 * A manifest line: facts side by side, divided by hairline rules, each a small label over its
 * value. Cells keep their natural width and wrap as a ruled line; values use tabular figures.
 */
export function ManifestStrip({
  fields,
  isFlush = false,
  className,
}: {
  fields: readonly ManifestField[];
  /** Inside a card: ruled underneath only, no frame of its own. */
  isFlush?: boolean;
  className?: string;
}) {
  return (
    <dl
      className={joinClassNames(
        'flex flex-wrap overflow-hidden bg-surface',
        isFlush ? 'border-b border-border' : 'rounded-sm border border-border',
        className,
      )}
    >
      {fields.map((field) => (
        <div
          key={field.label}
          className="-mr-px -mb-px min-w-[8.5rem] flex-auto border-r border-b border-border px-4 py-3"
        >
          <dt className="field-label">{field.label}</dt>
          <dd className="tabular mt-1 text-xl leading-tight font-semibold whitespace-nowrap text-primary">
            {field.value}
          </dd>
          {field.note ? <dd className="tabular text-xs whitespace-nowrap text-muted">{field.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
