/**
 * Public API of `@faysal1000/universal-chatbot`. Importing the package registers `<universal-chat-bot>`.
 * For JSX typing in React projects, also `import type {} from '@faysal1000/universal-chatbot/jsx';`.
 */
export type WidgetPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type WidgetLanguage = 'en' | 'bn';
export type WidgetTheme = 'light' | 'dark' | 'auto';

export declare const ELEMENT_NAME = 'universal-chat-bot';

/**
 * `<universal-chat-bot api-key="pk_…" api-url="https://…">`. Dispatches `chat-open` and `chat-close` (bubbling,
 * composed) when the panel opens or closes; the `open` attribute reflects the same state.
 */
export declare class UniversalChatBotElement extends HTMLElement {
  static readonly observedAttributes: string[];
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
}

/** Registers the element (idempotent). Importing the package already does this. */
export declare function defineUniversalChatBot(): void;

declare global {
  interface HTMLElementTagNameMap {
    'universal-chat-bot': UniversalChatBotElement;
  }
  interface HTMLElementEventMap {
    'chat-open': CustomEvent<undefined>;
    'chat-close': CustomEvent<undefined>;
  }
}
