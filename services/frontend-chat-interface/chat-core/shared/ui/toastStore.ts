import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
}

const TOAST_DURATION_MS = 3500;
const MAX_VISIBLE_TOASTS = 3;

let nextToastId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  show: (message, tone = 'info') => {
    const id = nextToastId++;
    set((state) => ({ toasts: [...state.toasts.slice(1 - MAX_VISIBLE_TOASTS), { id, message, tone }] }));
    setTimeout(() => get().dismiss(id), TOAST_DURATION_MS);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export const showToast = (message: string, tone?: Toast['tone']) =>
  useToastStore.getState().show(message, tone);
