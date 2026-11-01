import { X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { joinClassNames } from '../lib/classNames';
import { ToastContext } from './toastContext';
import type { ToastApi, ToastTone } from './toastContext';

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

const TOAST_DURATION_MILLISECONDS = 5000;

const toneClassNames: Record<ToastTone, string> = {
  success: 'border-good/50',
  error: 'border-critical/60',
  info: 'border-border-strong',
};

const toneLabels: Record<ToastTone, string> = { success: 'Done', error: 'Error', info: 'Info' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextToastId = useRef(1);

  const dismissToast = useCallback((toastId: number) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const toastId = nextToastId.current;
      nextToastId.current += 1;
      setToasts((currentToasts) => [...currentToasts.slice(-3), { id: toastId, message, tone }]);
      window.setTimeout(() => dismissToast(toastId), TOAST_DURATION_MILLISECONDS);
    },
    [dismissToast],
  );

  const toastApi = useMemo<ToastApi>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext value={toastApi}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100%-2rem)] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={joinClassNames(
              'pointer-events-auto flex items-start justify-between gap-3 rounded border bg-surface-raised px-3.5 py-2.5 text-sm shadow-lg',
              toneClassNames[toast.tone],
            )}
          >
            <p className="text-secondary">
              <span className="font-medium text-primary">{toneLabels[toast.tone]}: </span>
              {toast.message}
            </p>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
              className="rounded px-1 text-muted hover:text-primary"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
