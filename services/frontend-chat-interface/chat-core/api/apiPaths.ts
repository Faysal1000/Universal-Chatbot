import { PUBLIC_API_PREFIX } from './chatApiContract';

const segment = encodeURIComponent;

/** Every public chat API route in one place, so callers never assemble URLs by hand. */
export const apiPaths = {
  config: () => `${PUBLIC_API_PREFIX}/config`,
  sessions: () => `${PUBLIC_API_PREFIX}/sessions`,
  conversations: () => `${PUBLIC_API_PREFIX}/conversations`,
  conversation: (conversationId: string) => `${PUBLIC_API_PREFIX}/conversations/${segment(conversationId)}`,
  messages: (conversationId: string) => `${apiPaths.conversation(conversationId)}/messages`,
  turns: (conversationId: string) => `${apiPaths.conversation(conversationId)}/turns`,
  turnEvents: (conversationId: string, turnId: string) =>
    `${apiPaths.turns(conversationId)}/${segment(turnId)}/events`,
  cancelTurn: (conversationId: string, turnId: string) =>
    `${apiPaths.turns(conversationId)}/${segment(turnId)}/cancel`,
  attachments: () => `${PUBLIC_API_PREFIX}/attachments`,
  citationPreview: (citationId: string) => `${PUBLIC_API_PREFIX}/citations/${segment(citationId)}/preview`,
  messageFeedback: (messageId: string) => `${PUBLIC_API_PREFIX}/messages/${segment(messageId)}/feedback`,
} as const;

/** Appends defined, non-empty query parameters. */
export function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
