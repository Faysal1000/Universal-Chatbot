import { z } from 'zod';

import { REASONING_EFFORT_SETTINGS } from '../../database/schema.js';
import { MAX_MESSAGE_CHARS_CEILING } from '../chat/public-chat-limits.js';

/** Everything an admin can change; saving always appends a new version. */
export const chatbotSettingsInputSchema = z.object({
  botName: z.string().trim().min(1).max(80),
  greetingMessage: z.string().trim().min(1).max(1_000),
  suggestedPrompts: z.array(z.string().trim().min(1).max(200)).max(6),
  systemInstruction: z.string().trim().min(1).max(8_000),
  fallbackMessage: z.string().trim().min(1).max(1_000),
  answerOnlyFromDocuments: z
    .boolean()
    .describe('Send the fallback message when no document matches; off lets the model answer anyway'),
  answerTemperature: z.number().min(0).max(2),
  maxAnswerTokens: z.number().int().min(64).max(32_768),
  maxSources: z.number().int().min(1).max(20),
  minSimilarity: z
    .number()
    .min(0)
    .max(1)
    .describe('Dense cosine similarity a passage must reach to be used in an answer'),
  showReasoning: z.boolean(),
  showSources: z
    .boolean()
    .describe('Show citations and [n] markers to visitors; citations are stored either way'),
  reasoningEffort: z.enum(REASONING_EFFORT_SETTINGS),
  memorySummaryThresholdRatio: z
    .number()
    .min(0.1)
    .max(0.95)
    .describe('Share of the prompt budget history may use before older turns are summarised'),
  memoryRecentTurnCount: z.number().int().min(1).max(50).describe('Most recent turns always sent verbatim'),
  maxMessageChars: z
    .number()
    .int()
    .min(50)
    .max(MAX_MESSAGE_CHARS_CEILING)
    .describe('Longest message a visitor may send, in characters'),
  maxTurnsPerConversation: z.number().int().min(1).max(10_000),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((text) => (text === '' ? null : text))
    .nullable()
    .default(null)
    .describe('Why this version was saved; blank means no note'),
});
export type ChatbotSettingsInput = z.infer<typeof chatbotSettingsInputSchema>;

export const chatbotSettingsSchema = chatbotSettingsInputSchema.extend({
  note: z.string().nullable(),
  version: z.number().int(),
  isActive: z.boolean(),
  createdByAdminUserId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type ChatbotSettingsView = z.infer<typeof chatbotSettingsSchema>;

export const settingsVersionParameterSchema = z.coerce.number().int().min(1);
