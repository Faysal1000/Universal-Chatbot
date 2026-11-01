const MAXIMUM_TITLE_LENGTH = 60;
export const NEW_CONVERSATION_TITLE = 'New conversation';

/**
 * Title for a new conversation, from the visitor's first message: its first line, cut
 * on a word boundary. Cheap and instant, unlike asking a model.
 */
export function titleFromFirstMessage(messageText: string): string {
  const firstLine = messageText.trim().split(/\r?\n/, 1)[0]?.replace(/\s+/g, ' ') ?? '';
  if (firstLine === '') return NEW_CONVERSATION_TITLE;
  if (firstLine.length <= MAXIMUM_TITLE_LENGTH) return firstLine;
  const cut = firstLine.slice(0, MAXIMUM_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > MAXIMUM_TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
