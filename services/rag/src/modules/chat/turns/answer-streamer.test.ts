import { describe, expect, it } from 'vitest';

import type { LanguageModelPort, LanguageModelStreamEvent } from '../../../ports/language-model.port.js';
import type { ChatbotSettingsRecord } from '../../chatbot-settings/chatbot-settings.repository.js';
import type { AnswerPrompt } from './answer-prompt-assembler.js';
import { AnswerStreamer, EmptyAnswerError, PartialAnswer } from './answer-streamer.js';
import type { TurnControl } from './turn-control.js';
import type { TurnEventLog } from './turn-event-log.js';
import type { TurnExecution } from './turn-execution.js';

const ANSWER_CHUNKS = ['Annual leave is 24 days [', '1', ']. Sick leave', ' is separate [2, ', '3].'];
const FULL_ANSWER = 'Annual leave is 24 days [1]. Sick leave is separate [2, 3].';

function streamerAnswering(chunks: readonly string[], finishReason: 'stop' | 'length' = 'stop') {
  const shownDeltas: string[] = [];
  const turnEventLog = {
    append: (_turnId: string, eventName: string, payload: { text: string }) => {
      if (eventName === 'answer.delta') shownDeltas.push(payload.text);
      return Promise.resolve();
    },
  } as unknown as TurnEventLog;
  const turnControl = {
    markAnswerStarted: () => Promise.resolve(),
    readInterruption: () => Promise.resolve(undefined),
  } as unknown as TurnControl;
  const languageModel = {
    async *stream(): AsyncIterable<LanguageModelStreamEvent> {
      for (const text of chunks) yield await Promise.resolve({ type: 'content_delta' as const, text });
      yield {
        type: 'completed',
        finishReason,
        usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 0 },
        servedByModel: 'test-model',
      };
    },
  } as unknown as LanguageModelPort;
  return { streamer: new AnswerStreamer(turnEventLog, turnControl, languageModel), shownDeltas };
}

function executionWith(settings: Partial<ChatbotSettingsRecord>): TurnExecution {
  return {
    turnId: 'turn-1',
    settings: { answerTemperature: 0.2, reasoningEffort: 'off', showReasoning: false, ...settings },
    requestId: undefined,
    abortSignal: new AbortController().signal,
    startedAtMilliseconds: performance.now(),
  } as unknown as TurnExecution;
}

const prompt = { messages: [], maxOutputTokens: 256 } as unknown as AnswerPrompt;

describe('AnswerStreamer', () => {
  it('streams the answer as generated when sources are shown', async () => {
    const { streamer, shownDeltas } = streamerAnswering(ANSWER_CHUNKS);

    await streamer.stream(executionWith({ showSources: true }), prompt, new PartialAnswer());

    expect(shownDeltas.join('')).toBe(FULL_ANSWER);
  });

  it('removes markers split across deltas when sources are hidden, but keeps them in the answer', async () => {
    const { streamer, shownDeltas } = streamerAnswering(ANSWER_CHUNKS);

    const answer = await streamer.stream(executionWith({ showSources: false }), prompt, new PartialAnswer());

    expect(shownDeltas.join('')).toBe('Annual leave is 24 days. Sick leave is separate.');
    expect(shownDeltas.every((text) => text !== '')).toBe(true);
    expect(answer.content).toBe(FULL_ANSWER);
  });

  it('fails the turn when the output limit ran out before any answer text', async () => {
    const { streamer } = streamerAnswering([], 'length');

    const streaming = streamer.stream(executionWith({ showSources: true }), prompt, new PartialAnswer());

    await expect(streaming).rejects.toBeInstanceOf(EmptyAnswerError);
    await expect(streaming).rejects.toMatchObject({ code: 'answer_cut_off' });
  });
});
