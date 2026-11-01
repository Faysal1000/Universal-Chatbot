import { chatCoreEn } from '@chat-core/i18n/locales/en';

/** The chat app's English strings: the shared chat UI's plus the app shell's (sidebar, header, shortcuts). */
export const en = {
  ...chatCoreEn,
  app: {
    loading: 'Starting the assistant…',
    bootstrapFailed: 'The chat service could not be reached.',
    retry: 'Try again',
    offline: 'You are offline. Messages will be sent when the connection returns.',
    skipToComposer: 'Skip to message input',
  },
  sidebar: {
    title: 'Conversations',
    newChat: 'New chat',
    search: 'Search conversations',
    searchPlaceholder: 'Search…',
    noResults: 'No conversations match “{{query}}”.',
    empty: 'Your conversations will appear here.',
    loadFailed: 'Could not load conversations.',
    rename: 'Rename',
    delete: 'Delete',
    options: 'Conversation options',
    renameLabel: 'Conversation title',
    deleteTitle: 'Delete this conversation?',
    deleteDescription: '“{{title}}” and all of its messages will be permanently deleted.',
    cancel: 'Cancel',
    confirmDelete: 'Delete',
    open: 'Open sidebar',
    close: 'Close sidebar',
    groups: {
      today: 'Today',
      yesterday: 'Yesterday',
      week: 'Previous 7 days',
      month: 'Previous 30 days',
      older: 'Older',
    },
  },
  header: {
    settings: 'Settings',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    language: 'Language',
    shortcuts: 'Keyboard shortcuts',
  },
  shortcuts: {
    title: 'Keyboard shortcuts',
    close: 'Close keyboard shortcuts',
    send: 'Send message',
    newline: 'New line',
    newChat: 'New chat',
    search: 'Search conversations',
    stop: 'Stop generating / close panel',
    toggleSidebar: 'Toggle sidebar',
    focusComposer: 'Focus the message input',
    editLast: 'Edit last pending message',
    copyLast: 'Copy last answer',
    showShortcuts: 'Show this list',
  },
  toast: {
    ...chatCoreEn.toast,
    renameFailed: 'Could not rename the conversation.',
    deleteFailed: 'Could not delete the conversation.',
    lastAnswerCopied: 'Last answer copied',
    sessionRenewed: 'Your session was renewed, so earlier chats are no longer available.',
  },
};

type DeepStringRecord<T> = { [K in keyof T]: T[K] extends string ? string : DeepStringRecord<T[K]> };
export type TranslationResource = DeepStringRecord<typeof en>;
