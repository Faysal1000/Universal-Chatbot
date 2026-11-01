import { createStore } from 'zustand/vanilla';

import type { WidgetLanguage } from '../element/widgetSettings';

/** What the element tells the panel after mounting it. */
export interface PanelUiState {
  isOpen: boolean;
  language: WidgetLanguage;
}

export function createPanelUiStore(initial: PanelUiState) {
  return createStore<PanelUiState>()(() => initial);
}

export type PanelUiStore = ReturnType<typeof createPanelUiStore>;
