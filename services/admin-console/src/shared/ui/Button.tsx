import { RefreshCw } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { joinClassNames } from '../lib/classNames';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'small' | 'medium';

const variantClassNames: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-contrast hover:bg-accent-hover border-transparent disabled:bg-surface-raised disabled:text-muted disabled:border-border',
  secondary: 'bg-surface-raised text-primary border-border hover:border-border-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-secondary border-transparent hover:bg-surface-hover hover:text-primary',
  danger: 'bg-transparent text-critical-text border-border hover:border-critical hover:bg-critical/10',
};

const sizeClassNames: Record<ButtonSize, string> = {
  small: 'h-8 px-2.5 text-xs gap-1.5 pointer-coarse:h-11',
  medium: 'h-9 px-3.5 text-sm gap-2 pointer-coarse:h-11',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leadingIcon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'medium',
  isLoading = false,
  leadingIcon,
  disabled,
  className,
  children,
  type = 'button',
  ...buttonAttributes
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={(disabled ?? false) || isLoading}
      aria-busy={isLoading || undefined}
      className={joinClassNames(
        'inline-flex shrink-0 items-center justify-center rounded border font-medium whitespace-nowrap transition-colors',
        'disabled:cursor-not-allowed',
        variant === 'primary' ? 'disabled:opacity-100' : 'disabled:opacity-50',
        variantClassNames[variant],
        sizeClassNames[size],
        className,
      )}
      {...buttonAttributes}
    >
      {isLoading ? <Spinner size="small" /> : leadingIcon}
      {children}
    </button>
  );
}

/** The one refresh control every page header uses. */
export function RefreshButton({ isRefreshing, onRefresh }: { isRefreshing: boolean; onRefresh: () => void }) {
  return (
    <Button
      size="small"
      leadingIcon={<RefreshCw aria-hidden="true" className="size-3.5" />}
      isLoading={isRefreshing}
      onClick={onRefresh}
    >
      Refresh
    </Button>
  );
}
