import { describe, expect, it } from 'vitest';

import { validTestEnvironment } from '../../../../test/support/test-environment.js';
import { parseConfiguration } from '../../../config/configuration.js';
import type { HistoryTurn } from '../../../domain/chat/conversation-memory-planner.js';
import { TokenEstimator } from '../../../domain/text/token-estimator.js';
import type {
  LanguageModelCompletion,
  LanguageModelPort,
  LanguageModelRequest,
} from '../../../ports/language-model.port.js';
import { QueryRewriteService } from './query-rewrite.service.js';

class ScriptedLanguageModel implements LanguageModelPort {
  readonly requests: LanguageModelRequest[] = [];

  constructor(private readonly reply: string | Error) {}

  complete(request: LanguageModelRequest): Promise<LanguageModelCompletion> {
    this.requests.push(request);
    if (this.reply instanceof Error) return Promise.reject(this.reply);
    return Promise.resolve({
      content: this.reply,
      reasoning: null,
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 },
      servedByModel: 'local-models/test',
    });
  }

  stream(): never {
    throw new Error('Query rewriting never streams');
  }

  getTaskTokenLimits(): never {
    throw new Error('Query rewriting needs no token limits');
  }
}

const earlierTurn: HistoryTurn = {
  turnId: 'turn-1',
  messages: [
    { role: 'user', content: 'How many leave days do I get?', sequenceNumber: 1, estimatedTokenCount: 9 },
    { role: 'assistant', content: 'You get 24 working days [1].', sequenceNumber: 2, estimatedTokenCount: 9 },
  ],
};

function rewriterReplying(reply: string | Error) {
  const languageModel = new ScriptedLanguageModel(reply);
  const service = new QueryRewriteService(
    new TokenEstimator(1.2),
    languageModel,
    parseConfiguration(validTestEnvironment()),
  );
  return { service, languageModel };
}

function followUp(currentMessageTexts: string[], recentTurns: HistoryTurn[] = [earlierTurn]) {
  return {
    recentTurns,
    currentMessageTexts,
    requestId: undefined,
    abortSignal: new AbortController().signal,
  };
}

describe('QueryRewriteService', () => {
  it('searches a first, single question as typed without calling the model', async () => {
    const { service, languageModel } = rewriterReplying('{"queries": ["unused"]}');

    const queries = await service.rewrite(followUp(['What are the office hours?'], []));

    expect(queries).toEqual(['What are the office hours?']);
    expect(languageModel.requests).toHaveLength(0);
  });

  it('returns each distinct rewritten query once', async () => {
    const { service } = rewriterReplying(
      '{"queries": ["Carry over leave days", "carry over leave days", "Probation length"]}',
    );

    const queries = await service.rewrite(followUp(['Can I carry them over? And probation?']));

    expect(queries).toEqual(['Carry over leave days', 'Probation length']);
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const { service } = rewriterReplying('```json\n{"queries": ["ছুটি কত দিন"]}\n```');

    const queries = await service.rewrite(followUp(['আর ছুটি?']));

    expect(queries).toEqual(['ছুটি কত দিন']);
  });

  it('falls back to the visitor messages when the model fails', async () => {
    const { service } = rewriterReplying(new Error('gateway down'));

    const queries = await service.rewrite(followUp(['And for managers?', 'Also part-time staff?']));

    expect(queries).toEqual(['And for managers?\nAlso part-time staff?']);
  });

  it('falls back to the visitor messages when the reply is not the expected JSON', async () => {
    const { service } = rewriterReplying('Sure! Here are some queries: leave, probation');

    const queries = await service.rewrite(followUp(['And for managers?']));

    expect(queries).toEqual(['And for managers?']);
  });
});
