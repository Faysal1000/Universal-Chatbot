import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

import { joinClassNames } from '../lib/classNames';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'medium' | 'large';
}

/** Modal built on the native `<dialog>` element (focus trapping, Escape and top layer for free). */
export function Dialog({ isOpen, onClose, title, description, children, footer, width = 'medium' }: DialogProps) {
  const dialogReference = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialogElement = dialogReference.current;
    if (!dialogElement) return;
    if (isOpen && !dialogElement.open) dialogElement.showModal();
    if (!isOpen && dialogElement.open) dialogElement.close();
  }, [isOpen]);

  return (
    // Escape (onCancel) is the keyboard way out; closing on a backdrop click is a mouse convenience.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogReference}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(cancelEvent) => {
        cancelEvent.preventDefault();
        onClose();
      }}
      onClick={(clickEvent) => {
        if (clickEvent.target === dialogReference.current) onClose();
      }}
      className={joinClassNames(
        'm-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden rounded-md border border-border bg-surface p-0 text-primary shadow-[0_16px_40px_-12px_var(--shadow-overlay)]',
        width === 'large' ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {isOpen ? (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-primary"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
