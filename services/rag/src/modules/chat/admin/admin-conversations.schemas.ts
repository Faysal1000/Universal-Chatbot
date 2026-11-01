import { z } from 'zod';

import { CHAT_TURN_STATUSES, TURN_FINISH_REASONS } from '../../../database/schema.js';
import { retrievalTraceSchema } from '../../retrieval/retrieval-trace.js';
import { chatMessageSchema, conversationSchema } from '../conversations/public-chat.schemas.js';

export const adminConversationListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  visitorSessionId: z.uuid().optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const deleteConversationQuerySchema = z.object({
  force: z
    .enum(['true', 'false'])
    .transform((flag) => flag === 'true')
    .default(false)
    .describe('Delete even while a reply is being written, cancelling it'),
});

export type AdminConversationListQuery = z.infer<typeof adminConversationListQuerySchema>;

export const adminConversationSchema = conversationSchema.extend({
  visitorSessionId: z.uuid(),
  turnCount: z.number().int(),
});
export type AdminConversationView = z.infer<typeof adminConversationSchema>;

export const adminConversationPageSchema = z.object({
  items: z.array(adminConversationSchema),
  nextCursor: z.string().nullable(),
});

export const adminTurnSchema = z.object({
  id: z.uuid(),
  status: z.enum(CHAT_TURN_STATUSES),
  finishReason: z.enum(TURN_FINISH_REASONS).nullable(),
  failureCode: z.string().nullable(),
  rewrittenQueries: z.array(z.string()),
  chatbotSettingsVersion: z.number().int().nullable(),
  servedByModel: z.string().nullable(),
  usage: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    reasoningTokens: z.number().int(),
  }),
  timings: z.object({ ttftMs: z.number().int().nullable(), totalMs: z.number().int().nullable() }),
  createdAt: z.iso.datetime(),
  messages: z.array(chatMessageSchema),
  retrievalTrace: retrievalTraceSchema.nullable(),
});
export type AdminTurnView = z.infer<typeof adminTurnSchema>;

export const adminConversationDetailSchema = adminConversationSchema.extend({
  summary: z
    .object({ text: z.string(), coveredThroughMessageId: z.uuid(), updatedAt: z.iso.datetime() })
    .nullable(),
  turns: z.array(adminTurnSchema).describe('Every turn, hidden (superseded, replaced) ones included'),
});
export type AdminConversationDetailView = z.infer<typeof adminConversationDetailSchema>;

export const adminFeedbackSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  turnId: z.uuid(),
  rating: z.enum(['up', 'down']),
  comment: z.string().nullable(),
  questionExcerpt: z.string().describe("The turn's visitor messages, cut to 280 characters (… marks a cut)"),
  answerExcerpt: z.string().describe('The rated answer, cut the same way'),
  createdAt: z.iso.datetime(),
});
export type AdminFeedbackView = z.infer<typeof adminFeedbackSchema>;

export const feedbackListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
