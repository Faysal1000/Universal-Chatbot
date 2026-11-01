import { describe, expect, it } from 'vitest';

import { TokenEstimator } from '../../../domain/text/token-estimator.js';
import type { LanguageModelPort, TaskTokenLimits } from '../../../ports/language-model.port.js';
import type { ChatbotSettingsRecord } from '../../chatbot-settings/chatbot-settings.repository.js';
import { AnswerPromptAssembler, type AnswerPromptRequest } from './answer-prompt-assembler.js';

function assemblerWithLimits(limits: TaskTokenLimits): AnswerPromptAssembler {
  const languageModel = { getTaskTokenLimits: () => Promise.resolve(limits) } as unknown as LanguageModelPort;
  return new AnswerPromptAssembler(new TokenEstimator(1), languageModel);
}

const request: AnswerPromptRequest = {
  settings: {
    botName: 'Assistant',
    systemInstruction: 'Answer briefly.',
    maxAnswerTokens: 1_024,
    memorySummaryThresholdRatio: 0.6,
    memoryRecentTurnCount: 6,
  } as ChatbotSettingsRecord,
  sources: [
    {
      sourceNumber: 1,
      documentTitle: 'Handbook',
      pageStart: 1,
      pageEnd: 1,
      contextualHeader: '',
      text: 'Leave.',
    },
  ],
  currentMessages: [{ text: 'How much leave do I get?', imageDataUrls: [] }],
  history: { summary: undefined, unsummarisedTurns: [] },
};

describe('AnswerPromptAssembler', () => {
  it('gives a thinking model up to four times the answer length when the context has room', async () => {
    const prompt = await assemblerWithLimits({ contextWindowTokens: 12_288, maxOutputTokens: null }).assemble(
      request,
    );

    expect(prompt.maxOutputTokens).toBe(4_096);
  });

  it('never goes past the output limit the gateway reports', async () => {
    const prompt = await assemblerWithLimits({
      contextWindowTokens: 128_000,
      maxOutputTokens: 2_000,
    }).assemble(request);

    expect(prompt.maxOutputTokens).toBe(2_000);
  });

  it('keeps at least the answer length when the context is tight', async () => {
    const prompt = await assemblerWithLimits({ contextWindowTokens: 1_200, maxOutputTokens: null }).assemble(
      request,
    );

    expect(prompt.maxOutputTokens).toBe(1_024);
  });
});
