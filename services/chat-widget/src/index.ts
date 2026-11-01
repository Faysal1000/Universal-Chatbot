/**
 * `@faysal1000/universal-chatbot`: importing this module (or loading it from a CDN) registers
 * `<universal-chat-bot>`.
 */
import { defineUniversalChatBot } from './element/UniversalChatBotElement';

export {
  defineUniversalChatBot,
  ELEMENT_NAME,
  UniversalChatBotElement,
} from './element/UniversalChatBotElement';
export type { WidgetLanguage, WidgetTheme } from './element/widgetSettings';
export type { WidgetPosition } from './element/widgetPosition';

defineUniversalChatBot();
