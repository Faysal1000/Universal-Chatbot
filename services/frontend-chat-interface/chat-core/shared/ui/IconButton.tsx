import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { Tooltip } from './Tooltip';
import { cn } from './cn';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Accessible name; also shown as tooltip. */
  label: string;
  icon: ReactNode;
  tooltip?: boolean;
  size?: 'sm' | 'md';
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}

/** Square icon-only button with an accessible name and a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tooltip = true, size = 'md', className, tooltipSide, type = 'button', ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'size-7 [&_svg]:size-3.5' : 'size-9 [&_svg]:size-[18px]',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
  return tooltip ? (
    <Tooltip label={label} {...(tooltipSide ? { side: tooltipSide } : {})}>
      {button}
    </Tooltip>
  ) : (
    button
  );
});
