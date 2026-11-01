/** Anchor id of a message in the transcript, so other pages can link straight to it. */
export function messageAnchorId(messageId: string): string {
  return `message-${messageId}`;
}
