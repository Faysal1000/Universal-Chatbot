import { z } from 'zod';

/** Request and response schemas of the public chat API (contract v1 with the chat frontend). */

export const uuidParameterSchema = z.uuid();

export const conversationListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export const renameConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const messageListQuerySchema = z.object({
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const feedbackRequestSchema = z.object({
  rating: z.enum(['up', 'down']),
  comment: z.string().trim().max(2_000).optional(),
});

const boundingBoxSchema = z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() });

export const conversationSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastMessagePreview: z.string().nullable(),
});

export const conversationPageSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
});

export const attachmentSchema = z.object({
  id: z.uuid(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  url: z.string().describe('Server-relative, signed URL valid for 10 minutes'),
  expiresAt: z.iso.datetime(),
});

const citationSchema = z.object({
  id: z.uuid(),
  marker: z.number().int().positive(),
  kind: z.enum(['text', 'visual']),
  documentId: z.string(),
  documentTitle: z.string(),
  page: z.number().int().positive().describe('First page of the cited chunk'),
  snippet: z.string(),
  bbox: boundingBoxSchema.nullable().describe('Normalised 0–1 box on the page'),
  hasPreview: z.boolean(),
});

export const citationPreviewSchema = z.object({
  documentTitle: z.string(),
  page: z.number().int().positive(),
  snippet: z.string(),
  pageImageUrl: z.string().nullable(),
  cropImageUrl: z.string().nullable(),
  bbox: boundingBoxSchema.nullable(),
});
export type CitationPreviewView = z.infer<typeof citationPreviewSchema>;

export const chatMessageSchema = z.object({
  id: z.uuid(),
  turnId: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  attachments: z.array(attachmentSchema),
  citations: z.array(citationSchema),
  reasoning: z.string().nullable(),
  status: z.enum(['complete', 'stopped', 'error']),
  createdAt: z.iso.datetime(),
  feedback: z.enum(['up', 'down']).nullable(),
});
export type ChatMessageView = z.infer<typeof chatMessageSchema>;

export const chatMessagePageSchema = z.object({
  items: z.array(chatMessageSchema).describe('Chronological order'),
  nextCursor: z.string().nullable().describe('Pass as `before` to load older messages'),
});
