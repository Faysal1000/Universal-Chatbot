import type { ReactNode } from 'react';

import { joinClassNames } from '../lib/classNames';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border pb-4">
      <div className="flex min-h-9 min-w-0 flex-col justify-end">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A ruled section of a page: hairline frame, a header row with an optional one-line note, no shadow. */
export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={joinClassNames('rounded-sm border border-border bg-surface', className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            {title ? <h2 className="text-sm font-semibold text-primary">{title}</h2> : null}
            {description ? <p className="text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={joinClassNames('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
