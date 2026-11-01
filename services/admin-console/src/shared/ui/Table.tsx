import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

import { joinClassNames } from '../lib/classNames';

/**
 * Hairline table; scrolls sideways on narrow screens, and the scroll region takes keyboard focus.
 * `isStackedOnMobile` instead wraps each row as a block below 640px (use `max-sm:basis-full` on
 * cells that need a line of their own).
 */
export function Table({
  children,
  caption,
  isStackedOnMobile = false,
}: {
  children: ReactNode;
  caption?: string;
  isStackedOnMobile?: boolean;
}) {
  return (
    // A scrollable region must be focusable so keyboard users can scroll it (WCAG 2.1.1).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="scroll-edge-x relative overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className={joinClassNames('w-full border-collapse text-sm', isStackedOnMobile && 'table-stacked')}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function HeaderCell({
  isNumeric = false,
  className,
  ...cellAttributes
}: ThHTMLAttributes<HTMLTableCellElement> & { isNumeric?: boolean }) {
  return (
    <th
      scope="col"
      className={joinClassNames(
        'border-b border-border px-3 py-2 text-xs font-medium whitespace-nowrap text-muted',
        isNumeric ? 'text-right' : 'text-left',
        className,
      )}
      {...cellAttributes}
    />
  );
}

export function DataCell({
  isNumeric = false,
  className,
  ...cellAttributes
}: TdHTMLAttributes<HTMLTableCellElement> & { isNumeric?: boolean }) {
  return (
    <td
      className={joinClassNames(
        'border-b border-border px-3 py-2 align-middle text-secondary',
        isNumeric && 'numeric-cell',
        className,
      )}
      {...cellAttributes}
    />
  );
}
