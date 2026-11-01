/**
 * OpenAI Chat Completions wire format as spoken by services/llm-gateway, and the
 * translation to and from the LanguageModelPort types.
 */
import { z } from 'zod';

import type {
  LanguageModelFinishReason,
  LanguageModelMessage,
  LanguageModelRequest,
  LanguageModelUsage,
} from '../../ports/language-model.port.js';

const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative().default(0),
  completion_tokens: z.number().int().nonnegative().default(0),
  completion_tokens_details: z
    .object({ reasoning_tokens: z.number().int().nonnegative().nullish() })
    .nullish(),
});

export const chatCompletionResponseSchema = z.object({
  model: z.string().nullish(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          reasoning_content: z.string().nullish(),
        }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: usageSchema.nullish(),
});

export const chatCompletionChunkSchema = z.object({
  model: z.string().nullish(),
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().nullish(), reasoning_content: z.string().nullish() }).nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .default([]),
  usage: usageSchema.nullish(),
});

/** Mid-stream failure the gateway sends as `data: {"error": {...}}` before `[DONE]`. */
export const streamErrorSchema = z.object({
  error: z.object({ message: z.string().default('unknown error'), code: z.unknown().optional() }),
});

export const taskResolutionSchema = z.object({
  task_name: z.string(),
  limits: z.object({
    context_window_tokens: z.number().int().positive().nullable(),
    max_output_tokens: z.number().int().positive().nullable(),
  }),
});

export interface WireRequestOptions {
  readonly isStreaming: boolean;
}

export function toWireRequestBody(
  request: LanguageModelRequest,
  { isStreaming }: WireRequestOptions,
): Record<string, unknown> {
  return {
    model: request.task,
    messages: request.messages.map(toWireMessage),
    stream: isStreaming,
    ...(isStreaming ? { stream_options: { include_usage: true } } : {}),
    ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.reasoningEffort === undefined ? {} : { reasoning_effort: request.reasoningEffort }),
  };
}

function toWireMessage(message: LanguageModelMessage): Record<string, unknown> {
  if (typeof message.content === 'string') return { role: message.role, content: message.content };
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'image_url', image_url: { url: part.imageDataUrl } },
    ),
  };
}

export function toFinishReason(wireFinishReason: string | null | undefined): LanguageModelFinishReason {
  switch (wireFinishReason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'other';
  }
}

export function toUsage(wireUsage: z.infer<typeof usageSchema> | null | undefined): LanguageModelUsage {
  return {
    inputTokens: wireUsage?.prompt_tokens ?? 0,
    outputTokens: wireUsage?.completion_tokens ?? 0,
    reasoningTokens: wireUsage?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

/** Gateway errors use the OpenAI envelope `{"error": {"message", "type", "param", "code"}}`. */
export function describeGatewayError(errorBody: unknown): { message: string; code?: string } {
  const parsed = z
    .object({ error: z.object({ message: z.string(), code: z.unknown().optional() }) })
    .safeParse(errorBody);
  if (!parsed.success) return { message: typeof errorBody === 'string' ? errorBody : 'no error details' };
  const { message, code } = parsed.data.error;
  return { message, ...(typeof code === 'string' ? { code } : {}) };
}
