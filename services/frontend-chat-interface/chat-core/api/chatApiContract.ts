/**
 * Public chat API contract of the rag service (`/v1/public`, see services/rag/contracts/rag-api.openapi.json).
 *
 * Every payload that crosses the network is described here as a zod schema, so responses and SSE events are
 * validated at runtime, not just type-asserted.
 */
import { z } from 'zod';

export const PUBLIC_API_PREFIX = '/v1/public';
export const REQUEST_ID_HEADER = 'X-Request-ID';

// ── Configuration and sessions ───────────────────────────────────────────────────────────────────────────

export const chatLimitsSchema = z.object({
  maxImageBytes: z.number().int().positive(),
  allowedImageTypes: z.array(z.string()),
  maxImagesPerTurn: z.number().int().positive(),
  maxMessagesPerTurn: z.number().int().positive(),
  maxMessageChars: z.number().int().positive(),
});
export type ChatLimits = z.infer<typeof chatLimitsSchema>;

export const publicChatConfigSchema = z.object({
  botName: z.string(),
  greeting: z.string(),
  suggestedPrompts: z.array(z.string()),
  turnstileSiteKey: z.string().nullable(),
  /** Admin setting: when false, answers carry no citations or `[n]` markers. Older rag versions omit it. */
  showSources: z.boolean().default(true),
  limits: chatLimitsSchema,
  features: z.object({ reasoning: z.boolean(), feedback: z.boolean() }),
});
export type PublicChatConfig = z.infer<typeof publicChatConfigSchema>;

export const visitorSessionSchema = z.object({
  sessionId: z.string(),
  sessionToken: z.string(),
  expiresAt: z.string(),
});
export type VisitorSession = z.infer<typeof visitorSessionSchema>;

// ── Domain objects ───────────────────────────────────────────────────────────────────────────────────────

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessagePreview: z.string().nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationPageSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
});
export type ConversationPage = z.infer<typeof conversationPageSchema>;

export const attachmentSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  url: z.string(),
  expiresAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** Normalised (0–1) bounding box on the cited page. */
export const boundingBoxSchema = z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() });
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

/** `visual` citations point at a table, chart or figure crop rather than running text. */
export const citationKindSchema = z.enum(['text', 'visual']);
export type CitationKind = z.infer<typeof citationKindSchema>;

export const citationSchema = z.object({
  id: z.string(),
  marker: z.number().int().positive(),
  kind: citationKindSchema,
  documentId: z.string(),
  documentTitle: z.string(),
  /** First page of the cited chunk. */
  page: z.number().int().positive(),
  snippet: z.string(),
  bbox: boundingBoxSchema.nullable(),
  hasPreview: z.boolean(),
});
export type Citation = z.infer<typeof citationSchema>;

export const citationPreviewSchema = z.object({
  documentTitle: z.string(),
  page: z.number().int().positive(),
  snippet: z.string(),
  pageImageUrl: z.string().nullable(),
  cropImageUrl: z.string().nullable(),
  bbox: boundingBoxSchema.nullable(),
});
export type CitationPreview = z.infer<typeof citationPreviewSchema>;

const messageRoleSchema = z.enum(['user', 'assistant']);
const persistedMessageStatusSchema = z.enum(['complete', 'stopped', 'error']);
export const feedbackRatingSchema = z.enum(['up', 'down']);
export type FeedbackRating = z.infer<typeof feedbackRatingSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  turnId: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  attachments: z.array(attachmentSchema),
  citations: z.array(citationSchema),
  reasoning: z.string().nullable(),
  status: persistedMessageStatusSchema,
  createdAt: z.string(),
  feedback: feedbackRatingSchema.nullable(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** A page of history, newest page first; `nextCursor` is passed as `before` to load older messages. */
export const chatMessagePageSchema = z.object({
  items: z.array(chatMessageSchema),
  nextCursor: z.string().nullable(),
});
export type ChatMessagePage = z.infer<typeof chatMessagePageSchema>;

// ── Turn submission (a batch of user messages → one assistant reply) ─────────────────────────────────────

const turnUserMessageSchema = z.object({
  clientMessageId: z.string(),
  content: z.string(),
  attachmentIds: z.array(z.string()),
});

export const submitTurnRequestSchema = z.object({
  turnId: z.string(),
  messages: z.array(turnUserMessageSchema).min(1),
  /** Edit-and-resend / regenerate. Must be the conversation's latest turn (else 409 `turn_not_replaceable`). */
  replacesTurnId: z.string().nullable(),
});
export type SubmitTurnRequest = z.infer<typeof submitTurnRequestSchema>;

// ── SSE events ───────────────────────────────────────────────────────────────────────────────────────────

export const retrievalStageSchema = z.enum(['queued', 'rewriting', 'retrieving', 'generating']);
export type RetrievalStage = z.infer<typeof retrievalStageSchema>;

export const finishReasonSchema = z.enum(['stop', 'length', 'no_evidence', 'cancelled']);
export type FinishReason = z.infer<typeof finishReasonSchema>;

export const turnStreamEventSchemas = {
  'message.started': z.object({
    turnId: z.string(),
    conversationId: z.string(),
    assistantMessageId: z.string(),
    userMessages: z.array(z.object({ clientMessageId: z.string(), id: z.string() })),
  }),
  status: z.object({ stage: retrievalStageSchema, label: z.string().optional() }),
  'reasoning.delta': z.object({ text: z.string() }),
  'answer.delta': z.object({ text: z.string() }),
  'answer.citations': z.object({ citations: z.array(citationSchema) }),
  'conversation.updated': z.object({ conversation: conversationSchema }),
  /**
   * Server safety net: a newer turn arrived before this one streamed any answer token, so its messages were moved
   * into the newer turn and this stream closes. The client follows the newer turn instead.
   */
  'turn.superseded': z.object({ supersededByTurnId: z.string() }),
  'message.completed': z.object({
    assistantMessageId: z.string(),
    finishReason: finishReasonSchema,
    usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
    timings: z.object({ ttftMs: z.number(), totalMs: z.number() }),
  }),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().optional(),
  }),
} as const;

export type TurnStreamEventName = keyof typeof turnStreamEventSchemas;
export type TurnStreamEventPayload<Name extends TurnStreamEventName> = z.infer<
  (typeof turnStreamEventSchemas)[Name]
>;
/** Discriminated union of every typed stream event, keyed by `type`. */
export type TurnStreamEvent = {
  [Name in TurnStreamEventName]: { type: Name; eventId: string | null; data: TurnStreamEventPayload<Name> };
}[TurnStreamEventName];

export function isTurnStreamEventName(name: string): name is TurnStreamEventName {
  return Object.hasOwn(turnStreamEventSchemas, name);
}

// ── Errors (RFC 9457) ────────────────────────────────────────────────────────────────────────────────────

export const problemDetailsSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().optional(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().optional(),
  /** Quote this when reporting a problem; it is also returned as the `X-Request-ID` header. */
  requestId: z.string().optional(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  /** Present on 429 and 503 (alongside the `Retry-After` header). */
  retryAfterSeconds: z.number().optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const API_ERROR_CODES = {
  rateLimited: 'rate_limited',
  serviceUnavailable: 'service_unavailable',
  attachmentTooLarge: 'attachment_too_large',
  unsupportedMediaType: 'unsupported_media_type',
  sessionExpired: 'session_expired',
  turnInProgress: 'turn_in_progress',
  turnNotReplaceable: 'turn_not_replaceable',
  idempotencyConflict: 'idempotency_conflict',
  validationFailed: 'validation_failed',
  notFound: 'not_found',
  upstreamFailed: 'upstream_failed',
} as const;
