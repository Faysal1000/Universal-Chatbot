import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastApi {
  showToast: (message: string, tone?: ToastTone) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const toastApi = useContext(ToastContext);
  if (!toastApi) throw new Error('useToast must be used inside <ToastProvider>.');
  return toastApi;
}
