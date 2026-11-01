/** Limits the chat client enforces before sending, and the server enforces again. */
export const PUBLIC_CHAT_LIMITS = {
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxImagesPerTurn: 4,
  maxMessagesPerTurn: 10,
} as const;

/** Highest message length an admin may allow (`chatbot_settings.max_message_chars`). */
export const MAX_MESSAGE_CHARS_CEILING = 8_000;
