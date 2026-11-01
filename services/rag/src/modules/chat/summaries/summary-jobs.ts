import { z } from 'zod';

export const summariseConversationPayloadSchema = z.object({
  conversationId: z.uuid(),
  /** Fold messages up to and including this sequence number into the rolling summary. */
  throughSequenceNumber: z.number().int().positive(),
});
export type SummariseConversationPayload = z.infer<typeof summariseConversationPayloadSchema>;

/** One job per target position: repeated requests for the same summary collapse. */
export function conversationSummaryJobId(payload: SummariseConversationPayload): string {
  return `${payload.conversationId}.${payload.throughSequenceNumber}`;
}
