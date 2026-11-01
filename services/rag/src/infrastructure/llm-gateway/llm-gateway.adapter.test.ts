import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  jsonResponder,
  ScriptedHttpServer,
  serverSentEventsResponder,
} from '../../../test/support/scripted-http-server.js';
import { validTestEnvironment } from '../../../test/support/test-environment.js';
import { parseConfiguration } from '../../config/configuration.js';
import type { LanguageModelStreamEvent } from '../../ports/language-model.port.js';
import { LlmGatewayAdapter } from './llm-gateway.adapter.js';

const chunk = (delta: Record<string, string>, finishReason: string | null = null) => ({
  model: 'answer_generation',
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});

async function collect(events: AsyncIterable<LanguageModelStreamEvent>): Promise<LanguageModelStreamEvent[]> {
  const collected: LanguageModelStreamEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe('LlmGatewayAdapter', () => {
  let gateway: ScriptedHttpServer;
  let adapter: LlmGatewayAdapter;

  beforeEach(async () => {
    gateway = await ScriptedHttpServer.start();
    adapter = new LlmGatewayAdapter(
      parseConfiguration(
        validTestEnvironment({
          RAG_LLM_GATEWAY_URL: gateway.baseUrl,
          RAG_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_MILLISECONDS: '1000',
        }),
      ),
    );
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('streams reasoning before content and finishes with usage from the final chunk', async () => {
    gateway.respondWith(
      serverSentEventsResponder(
        [
          chunk({ reasoning_content: 'Checking sources.' }),
          chunk({ content: 'Open ' }),
          chunk({ content: '9–5 [1].' }, 'stop'),
          {
            choices: [],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 9,
              completion_tokens_details: { reasoning_tokens: 4 },
            },
          },
        ],
        { headers: { 'x-llm-gateway-model': 'openai/gpt-5-mini' } },
      ),
    );

    const events = await collect(
      adapter.stream(
        {
          task: 'answer_generation',
          messages: [{ role: 'user', content: 'When are you open?' }],
          reasoningEffort: 'low',
          requestId: 'request-1',
        },
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { type: 'reasoning_delta', text: 'Checking sources.' },
      { type: 'content_delta', text: 'Open ' },
      { type: 'content_delta', text: '9–5 [1].' },
      {
        type: 'completed',
        finishReason: 'stop',
        usage: { inputTokens: 120, outputTokens: 9, reasoningTokens: 4 },
        servedByModel: 'openai/gpt-5-mini',
      },
    ]);
    const request = gateway.recordedRequests[0];
    expect(request?.headers.authorization).toBe('Bearer test-llm-gateway-api-key');
    expect(request?.headers['x-request-id']).toBe('request-1');
    expect(JSON.parse(request?.bodyText ?? '')).toMatchObject({
      model: 'answer_generation',
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: 'low',
    });
  });

  it('raises a non-retryable error when the gateway reports a failure after tokens were sent', async () => {
    gateway.respondWith(
      serverSentEventsResponder([chunk({ content: 'Partial' }), { error: { message: 'upstream reset' } }]),
    );

    const events: LanguageModelStreamEvent[] = [];
    const failure = (async () => {
      for await (const event of adapter.stream(
        { task: 'answer_generation', messages: [{ role: 'user', content: 'Hi' }] },
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    await expect(failure).rejects.toMatchObject({
      isRetryable: false,
      message: expect.stringContaining('upstream reset') as unknown,
    });
    expect(events).toEqual([{ type: 'content_delta', text: 'Partial' }]);
  });

  it('treats a stream that closes without [DONE] as interrupted', async () => {
    gateway.respondWith(serverSentEventsResponder([chunk({ content: 'Hel' })], { endWithDone: false }));

    await expect(
      collect(adapter.stream({ task: 'answer_generation', messages: [] }, new AbortController().signal)),
    ).rejects.toThrow('stream ended before [DONE]');
  });

  it('maps an OpenAI error envelope on a non-streamed call', async () => {
    gateway.respondWith(
      jsonResponder(400, {
        error: { message: 'max_tokens too large', type: 'invalid_request_error', code: 'bad' },
      }),
    );

    await expect(
      adapter.complete({ task: 'query_rewrite', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ isRetryable: false, details: { httpStatus: 400, upstreamCode: 'bad' } });
  });

  it('returns content and reasoning of a non-streamed completion', async () => {
    gateway.respondWith(
      jsonResponder(200, {
        model: 'local-models/qwen',
        choices: [
          { message: { content: 'rewritten query', reasoning_content: null }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 3 },
      }),
    );

    const completion = await adapter.complete({ task: 'query_rewrite', messages: [], temperature: 0 });

    expect(completion).toEqual({
      content: 'rewritten query',
      reasoning: null,
      finishReason: 'stop',
      usage: { inputTokens: 30, outputTokens: 3, reasoningTokens: 0 },
      servedByModel: 'local-models/qwen',
    });
  });

  it('sends no reasoning field for a request without a reasoning effort', async () => {
    gateway.respondWith(
      jsonResponder(200, {
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );

    await adapter.complete({ task: 'query_rewrite', messages: [] });

    const requestBody = JSON.parse(gateway.recordedRequests[0]?.bodyText ?? '') as Record<string, unknown>;
    expect(Object.keys(requestBody).sort()).toEqual(['messages', 'model', 'stream']);
  });

  it('caches task limits between calls', async () => {
    gateway.respondWith(
      jsonResponder(200, {
        task_name: 'answer_generation',
        is_routed: true,
        requires_vision: false,
        models: [],
        limits: { context_window_tokens: 32768, max_output_tokens: 8192 },
      }),
    );

    const firstLimits = await adapter.getTaskTokenLimits('answer_generation');
    const secondLimits = await adapter.getTaskTokenLimits('answer_generation');

    expect(firstLimits).toEqual({ contextWindowTokens: 32768, maxOutputTokens: 8192 });
    expect(secondLimits).toBe(firstLimits);
    expect(gateway.recordedRequests).toHaveLength(1);
    expect(gateway.recordedRequests[0]?.path).toBe('/v1/tasks/answer_generation');
  });
});
