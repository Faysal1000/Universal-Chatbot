import { chatCoreEn } from '@chat-core/i18n/locales/en';

/** English strings of the widget: the shared chat UI's plus the widget's own frame. */
export const en = {
  ...chatCoreEn,
  widget: {
    subtitle: 'Answers from verified sources',
    newChat: 'New chat',
    close: 'Close chat',
    switchLanguage: 'Switch to Bangla',
    otherLanguage: 'বাংলা',
    loading: 'Starting the assistant…',
    unavailable: 'The chat could not be reached right now.',
    retry: 'Try again',
    offline: 'You are offline. Messages will be sent when the connection returns.',
    closeSource: 'Back to the chat',
  },
  toast: {
    ...chatCoreEn.toast,
    sessionRenewed: 'Your session was renewed, so earlier chats are no longer available.',
  },
};

type DeepStringRecord<T> = { [K in keyof T]: T[K] extends string ? string : DeepStringRecord<T[K]> };
export type WidgetTranslation = DeepStringRecord<typeof en>;
