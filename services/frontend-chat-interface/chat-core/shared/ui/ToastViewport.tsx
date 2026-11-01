import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from './cn';
import { useToastStore } from './toastStore';

/** Announces transient messages politely (errors assertively) and shows them bottom-centre. */
export function ToastViewport() {
  const { t } = useTranslation();
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-elevated',
            toast.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-canvas',
          )}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            aria-label={t('toast.dismiss')}
            onClick={() => dismiss(toast.id)}
            className="opacity-70 hover:opacity-100"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
