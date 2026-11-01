import { create } from 'zustand';

interface ComposerUiState {
  /** Pending message currently being edited inline (ArrowUp in an empty composer, or the edit button). */
  editingPendingId: string | null;
  /** Incremented to ask the composer to take focus. */
  focusRequest: number;
  startEditingPending: (clientMessageId: string | null) => void;
  requestFocus: () => void;
}

export const useComposerUiStore = create<ComposerUiState>()((set) => ({
  editingPendingId: null,
  focusRequest: 0,
  startEditingPending: (clientMessageId) => set({ editingPendingId: clientMessageId }),
  requestFocus: () => set((state) => ({ focusRequest: state.focusRequest + 1 })),
}));
