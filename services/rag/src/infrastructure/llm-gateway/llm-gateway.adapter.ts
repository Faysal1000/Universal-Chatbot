import type { ReadableStreamDefaultReader, ReadableStreamReadResult } from 'node:stream/web';

import { Inject, Injectable } from '@nestjs/common';

import {
  fetchWithTimeout,
  sendJsonRequest,
  upstreamErrorFromResponse,
} from '../../common/outbound-http/json-http-client.js';
import { type RetryPolicy, retryWithBackoff } from '../../common/outbound-http/retry-with-backoff.js';
import { ServerSentEventsDecoder } from '../../common/outbound-http/server-sent-events-decoder.js';
import { UpstreamServiceError } from '../../common/outbound-http/upstream-service-error.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import type {
  LanguageModelCompletion,
  LanguageModelPort,
  LanguageModelRequest,
  LanguageModelStreamEvent,
  TaskTokenLimits,
} from '../../ports/language-model.port.js';
import {
  chatCompletionChunkSchema,
  chatCompletionResponseSchema,
  describeGatewayError,
  streamErrorSchema,
  taskResolutionSchema,
  toFinishReason,
  toUsage,
  toWireRequestBody,
} from './chat-completion-wire-format.js';
import { parseJsonOrUndefined } from '../../common/text/parse-json-or-undefined.js';

const SERVICE_NAME = 'llm-gateway';
const STREAM_END_MARKER = '[DONE]';
/** The gateway already retries and falls back across models; one extra attempt covers blips. */
const COMPLETION_RETRY_POLICY: RetryPolicy = {
  maximumAttempts: 2,
  initialDelayMilliseconds: 500,
  maximumDelayMilliseconds: 5_000,
};

interface CachedTaskLimits {
  readonly limits: TaskTokenLimits;
  readonly expiresAtMilliseconds: number;
}

/** OpenAI Chat Completions client for services/llm-gateway; `model` carries the task name. */
@Injectable()
export class LlmGatewayAdapter implements LanguageModelPort {
  private readonly settings: ServiceConfiguration['llmGateway'];
  private readonly taskLimitsCache = new Map<string, CachedTaskLimits>();

  constructor(@Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration) {
    this.settings = configuration.llmGateway;
  }

  complete(request: LanguageModelRequest, abortSignal?: AbortSignal): Promise<LanguageModelCompletion> {
    return retryWithBackoff(
      () => this.requestCompletion(request, abortSignal),
      COMPLETION_RETRY_POLICY,
      abortSignal,
    );
  }

  async *stream(
    request: LanguageModelRequest,
    abortSignal: AbortSignal,
  ): AsyncIterable<LanguageModelStreamEvent> {
    const response = await this.openStream(request, abortSignal);
    const servedByModel = response.headers.get('x-llm-gateway-model');
    yield* readCompletionStream(
      response,
      servedByModel,
      this.settings.streamIdleTimeoutMilliseconds,
      abortSignal,
    );
  }

  async getTaskTokenLimits(task: string): Promise<TaskTokenLimits> {
    const cached = this.taskLimitsCache.get(task);
    if (cached !== undefined && cached.expiresAtMilliseconds > Date.now()) return cached.limits;
    const limits = await this.requestTaskLimits(task);
    this.taskLimitsCache.set(task, {
      limits,
      expiresAtMilliseconds: Date.now() + this.settings.taskLimitsCacheSeconds * 1_000,
    });
    return limits;
  }

  private async requestCompletion(
    request: LanguageModelRequest,
    abortSignal?: AbortSignal,
  ): Promise<LanguageModelCompletion> {
    const responseBody = await sendJsonRequest(
      SERVICE_NAME,
      `chat completion (${request.task})`,
      {
        method: 'POST',
        url: `${this.settings.url}/v1/chat/completions`,
        headers: this.requestHeaders(request.requestId),
        body: toWireRequestBody(request, { isStreaming: false }),
        timeoutMilliseconds: this.settings.timeoutMilliseconds,
        ...(abortSignal === undefined ? {} : { abortSignal }),
      },
      describeGatewayError,
    );
    const parsed = chatCompletionResponseSchema.safeParse(responseBody);
    const choice = parsed.success ? parsed.data.choices[0] : undefined;
    if (!parsed.success || choice === undefined) {
      throw new UpstreamServiceError(SERVICE_NAME, 'chat completion', 'unexpected response shape', {
        isRetryable: false,
      });
    }
    return {
      content: choice.message.content ?? '',
      reasoning: choice.message.reasoning_content ?? null,
      finishReason: toFinishReason(choice.finish_reason),
      usage: toUsage(parsed.data.usage),
      servedByModel: parsed.data.model ?? null,
    };
  }

  private async openStream(request: LanguageModelRequest, abortSignal: AbortSignal): Promise<Response> {
    const operation = `chat completion stream (${request.task})`;
    const response = await fetchWithTimeout(SERVICE_NAME, operation, {
      method: 'POST',
      url: `${this.settings.url}/v1/chat/completions`,
      headers: { ...this.requestHeaders(request.requestId), accept: 'text/event-stream' },
      body: toWireRequestBody(request, { isStreaming: true }),
      // Covers connecting and the first byte; the idle timeout takes over while streaming.
      timeoutMilliseconds: this.settings.timeoutMilliseconds,
      abortSignal,
    });
    if (!response.ok) {
      throw await upstreamErrorFromResponse(SERVICE_NAME, operation, response, describeGatewayError);
    }
    return response;
  }

  private async requestTaskLimits(task: string): Promise<TaskTokenLimits> {
    const responseBody = await sendJsonRequest(
      SERVICE_NAME,
      'resolve task',
      {
        method: 'GET',
        url: `${this.settings.url}/v1/tasks/${encodeURIComponent(task)}`,
        headers: this.requestHeaders(undefined),
        timeoutMilliseconds: Math.min(this.settings.timeoutMilliseconds, 10_000),
      },
      describeGatewayError,
    );
    const parsed = taskResolutionSchema.safeParse(responseBody);
    if (!parsed.success) {
      throw new UpstreamServiceError(SERVICE_NAME, 'resolve task', 'unexpected response shape', {
        isRetryable: false,
      });
    }
    return {
      contextWindowTokens: parsed.data.limits.context_window_tokens,
      maxOutputTokens: parsed.data.limits.max_output_tokens,
    };
  }

  private requestHeaders(requestId: string | undefined): Record<string, string> {
    return {
      authorization: `Bearer ${this.settings.apiKey.reveal()}`,
      ...(requestId === undefined ? {} : { 'x-request-id': requestId }),
    };
  }
}

/**
 * Turns the gateway's SSE body into port events. Fails if no data arrives for
 * `idleTimeoutMilliseconds`, if the gateway reports a mid-stream error, or if the stream
 * ends without `[DONE]`.
 */
async function* readCompletionStream(
  response: Response,
  servedByModel: string | null,
  idleTimeoutMilliseconds: number,
  abortSignal: AbortSignal,
): AsyncIterable<LanguageModelStreamEvent> {
  if (response.body === null) throw streamFailure('empty response body', true);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const decoder = new ServerSentEventsDecoder();
  const completion = new StreamCompletionState(servedByModel);
  try {
    for (;;) {
      const { done, value } = await readWithIdleTimeout(reader, idleTimeoutMilliseconds, abortSignal);
      if (done) throw streamFailure('stream ended before [DONE]', true);
      for (const serverSentEvent of decoder.decode(value)) {
        if (serverSentEvent.data === STREAM_END_MARKER) {
          yield completion.toCompletedEvent();
          return;
        }
        yield* completion.consumeChunk(serverSentEvent.data);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Accumulates the finish reason and usage, which arrive in the last chunks. */
class StreamCompletionState {
  private finishReason: string | null = null;
  private usage: ReturnType<typeof toUsage> = toUsage(undefined);
  private hasSeenData = false;

  constructor(private servedByModel: string | null) {}

  *consumeChunk(chunkText: string): Iterable<LanguageModelStreamEvent> {
    const chunkJson = parseJsonOrUndefined(chunkText);
    const streamError = streamErrorSchema.safeParse(chunkJson);
    if (streamError.success) {
      // Tokens were already delivered, so retrying would duplicate them.
      throw streamFailure(streamError.data.error.message, !this.hasSeenData);
    }
    const parsed = chatCompletionChunkSchema.safeParse(chunkJson);
    if (!parsed.success) throw streamFailure('unexpected chunk shape', false);
    this.servedByModel ??= parsed.data.model ?? null;
    if (parsed.data.usage) this.usage = toUsage(parsed.data.usage);
    for (const choice of parsed.data.choices) {
      if (choice.finish_reason) this.finishReason = choice.finish_reason;
      const reasoningText = choice.delta?.reasoning_content;
      const contentText = choice.delta?.content;
      if (reasoningText) {
        this.hasSeenData = true;
        yield { type: 'reasoning_delta', text: reasoningText };
      }
      if (contentText) {
        this.hasSeenData = true;
        yield { type: 'content_delta', text: contentText };
      }
    }
  }

  toCompletedEvent(): LanguageModelStreamEvent {
    return {
      type: 'completed',
      finishReason: toFinishReason(this.finishReason),
      usage: this.usage,
      servedByModel: this.servedByModel,
    };
  }
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<string>,
  idleTimeoutMilliseconds: number,
  abortSignal: AbortSignal,
): Promise<ReadableStreamReadResult<string>> {
  abortSignal.throwIfAborted();
  let timeoutHandle: NodeJS.Timeout | undefined;
  let rejectOnAbort: (() => void) | undefined;
  const interruption = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(streamFailure(`no data for ${idleTimeoutMilliseconds} ms`, true));
    }, idleTimeoutMilliseconds);
    rejectOnAbort = () => {
      reject(abortSignal.reason as Error);
    };
    abortSignal.addEventListener('abort', rejectOnAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), interruption]);
  } finally {
    clearTimeout(timeoutHandle);
    if (rejectOnAbort !== undefined) abortSignal.removeEventListener('abort', rejectOnAbort);
  }
}

function streamFailure(message: string, isRetryable: boolean): UpstreamServiceError {
  return new UpstreamServiceError(SERVICE_NAME, 'chat completion stream', message, { isRetryable });
}
