/**
 * Minimal URL routing: `/` is a new chat, `/c/:conversationId` is a conversation. A router library would add
 * weight for two routes; the History API is enough and keeps the controller the single source of truth.
 */
const CONVERSATION_PATH = /^\/c\/([^/]+)\/?$/;

export function conversationIdFromPath(pathname: string = window.location.pathname): string | null {
  const match = CONVERSATION_PATH.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function pathForConversation(conversationId: string | null): string {
  return conversationId ? `/c/${encodeURIComponent(conversationId)}` : '/';
}

export function writeConversationToUrl(conversationId: string | null, mode: 'push' | 'replace'): void {
  const path = pathForConversation(conversationId);
  if (window.location.pathname === path) return;
  if (mode === 'push') window.history.pushState(null, '', path);
  else window.history.replaceState(null, '', path);
}
