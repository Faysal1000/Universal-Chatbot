import { create } from 'zustand';

import type { Citation } from '@chat-core/api/chatApiContract';

interface CitationPanelState {
  citation: Citation | null;
  /** All citations of the answer, for previous/next navigation inside the panel. */
  siblings: readonly Citation[];
  open: (citation: Citation, siblings: readonly Citation[]) => void;
  close: () => void;
}

export const useCitationPanelStore = create<CitationPanelState>()((set) => ({
  citation: null,
  siblings: [],
  open: (citation, siblings) => set({ citation, siblings }),
  close: () => set({ citation: null }),
}));
