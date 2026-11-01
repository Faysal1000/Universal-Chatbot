import { describe, expect, it } from 'vitest';

import { TokenEstimator } from '../text/token-estimator.js';
import { type HistoryTurn, planConversationMemory } from './conversation-memory-planner.js';

let nextSequenceNumber = 1;
function turnOf(turnId: string, tokensPerMessage: number): HistoryTurn {
  return {
    turnId,
    messages: (['user', 'assistant'] as const).map((role) => ({
      role,
      content: `${role} text`,
      sequenceNumber: nextSequenceNumber++,
      estimatedTokenCount: tokensPerMessage,
    })),
  };
}

const basePlan = { summaryTokenCount: null, summaryThresholdTokens: 10_000, recentTurnCount: 2 };

describe('planConversationMemory', () => {
  it('sends the whole history when it fits', () => {
    const turns = [turnOf('t1', 10), turnOf('t2', 10)];

    const plan = planConversationMemory({ ...basePlan, unsummarisedTurns: turns, historyBudgetTokens: 100 });

    expect(plan.includedTurns.map((turn) => turn.turnId)).toEqual(['t1', 't2']);
    expect(plan.omittedTurnCount).toBe(0);
  });

  it('drops the oldest turns from the prompt when the budget would overflow', () => {
    const turns = [turnOf('t1', 30), turnOf('t2', 30), turnOf('t3', 30)];

    const plan = planConversationMemory({ ...basePlan, unsummarisedTurns: turns, historyBudgetTokens: 130 });

    expect(plan.includedTurns.map((turn) => turn.turnId)).toEqual(['t2', 't3']);
    expect(plan.omittedTurnCount).toBe(1);
    expect(plan.tokenCount).toBe(120);
  });

  it('includes the rolling summary when it fits beside the turns', () => {
    const plan = planConversationMemory({
      ...basePlan,
      unsummarisedTurns: [turnOf('t1', 10)],
      summaryTokenCount: 50,
      historyBudgetTokens: 100,
    });

    expect(plan.includeSummary).toBe(true);
    expect(plan.tokenCount).toBe(70);
  });

  it('prefers the recent turns over the summary when space is short', () => {
    const plan = planConversationMemory({
      ...basePlan,
      unsummarisedTurns: [turnOf('t1', 20)],
      summaryTokenCount: 80,
      historyBudgetTokens: 60,
    });

    expect(plan.includeSummary).toBe(false);
    expect(plan.includedTurns).toHaveLength(1);
  });

  it('asks to summarise everything but the recent turns once history passes the threshold', () => {
    const turns = [turnOf('t1', 40), turnOf('t2', 40), turnOf('t3', 40), turnOf('t4', 40)];

    const plan = planConversationMemory({
      ...basePlan,
      unsummarisedTurns: turns,
      historyBudgetTokens: 1_000,
      summaryThresholdTokens: 200,
    });

    expect(plan.summariseThroughSequenceNumber).toBe(turns[1]?.messages[1]?.sequenceNumber);
  });

  it('does not ask for a summary below the threshold', () => {
    const plan = planConversationMemory({
      ...basePlan,
      unsummarisedTurns: [turnOf('t1', 10), turnOf('t2', 10), turnOf('t3', 10)],
      historyBudgetTokens: 1_000,
      summaryThresholdTokens: 200,
    });

    expect(plan.summariseThroughSequenceNumber).toBeNull();
  });

  it('budgets Bengali text by its real token cost, which is several times its word count', () => {
    const tokenEstimator = new TokenEstimator(1.2);
    const bengaliSentence = 'আমাদের প্রতিষ্ঠানের ছুটির নীতি কী এবং কত দিন ছুটি পাওয়া যায়?';
    const bengaliTokens = tokenEstimator.estimateMessage(bengaliSentence);
    const englishTokens = tokenEstimator.estimateMessage(
      'What is our leave policy and how many days off do we get?',
    );
    const bengaliTurn = turnOf('bn', bengaliTokens);

    const plan = planConversationMemory({
      ...basePlan,
      unsummarisedTurns: [bengaliTurn, turnOf('en', englishTokens)],
      historyBudgetTokens: englishTokens * 2 + bengaliTokens,
    });

    expect(bengaliTokens).toBeGreaterThan(englishTokens);
    expect(plan.includedTurns.map((turn) => turn.turnId)).toEqual(['en']);
  });
});
