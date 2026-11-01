/**
 * JSX typing for `<universal-chat-bot>` in React (and other TSX) projects:
 * `import type {} from '@faysal1000/universal-chatbot/jsx';` once, e.g. in a `global.d.ts`.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type UniversalChatBotAttributes = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  'api-key': string;
  'api-url': string;
  'primary-color'?: string;
  theme?: 'light' | 'dark' | 'auto';
  position?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'middle-left'
    | 'middle-center'
    | 'middle-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';
  /** Gap to the left/right screen edge: pixels (`24`) or a CSS length (`2rem`). Default `20px`. */
  'offset-x'?: number | string;
  /** Gap to the top/bottom screen edge: pixels (`96`) or a CSS length (`6rem`). Default `20px`. */
  'offset-y'?: number | string;
  greeting?: string;
  'greeting-duration-ms'?: number | string;
  language?: 'en' | 'bn';
  open?: boolean;
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'universal-chat-bot': UniversalChatBotAttributes;
    }
  }
}
