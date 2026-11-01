/** A completed earlier turn: the visitor's messages and the assistant's reply, in order. */
export interface HistoryTurn {
  readonly turnId: string;
  readonly messages: readonly HistoryMessage[];
}

export interface HistoryMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly sequenceNumber: number;
  readonly estimatedTokenCount: number;
}

export interface MemoryPlanRequest {
  /** Turns not yet covered by the rolling summary, oldest first. */
  readonly unsummarisedTurns: readonly HistoryTurn[];
  readonly summaryTokenCount: number | null;
  /** Tokens left for summary + history once everything else in the prompt is counted. */
  readonly historyBudgetTokens: number;
  /** History beyond this many tokens asks for older turns to be summarised. */
  readonly summaryThresholdTokens: number;
  /** Most recent turns that are never summarised. */
  readonly recentTurnCount: number;
}

export interface MemoryPlan {
  readonly includeSummary: boolean;
  /** Turns sent verbatim, oldest first. */
  readonly includedTurns: readonly HistoryTurn[];
  /** Older turns left out of this prompt only; the database keeps them. */
  readonly omittedTurnCount: number;
  /** Estimated tokens of the included summary and turns. */
  readonly tokenCount: number;
  /** Sequence number up to which a summary job should fold messages in; null when none is due. */
  readonly summariseThroughSequenceNumber: number | null;
}

/**
 * Decides what conversation history goes into the prompt: the rolling summary, then the
 * newest turns that still fit. Recent turns win over the summary when space is short;
 * turns that do not fit are dropped from the prompt, never from storage.
 */
export function planConversationMemory(request: MemoryPlanRequest): MemoryPlan {
  const turnTokenCounts = request.unsummarisedTurns.map(turnTokenCount);
  const historyTokenCount = sum(turnTokenCounts);
  const summaryTokenCount = request.summaryTokenCount ?? 0;

  let remainingBudget = request.historyBudgetTokens;
  let includedFromIndex = request.unsummarisedTurns.length;
  for (let index = request.unsummarisedTurns.length - 1; index >= 0; index -= 1) {
    const turnTokens = turnTokenCounts[index] ?? 0;
    const isRecentTurn = request.unsummarisedTurns.length - index <= request.recentTurnCount;
    const reservedForSummary = isRecentTurn ? 0 : summaryTokenCount;
    if (turnTokens > remainingBudget - reservedForSummary) break;
    remainingBudget -= turnTokens;
    includedFromIndex = index;
  }
  const includeSummary = request.summaryTokenCount !== null && summaryTokenCount <= remainingBudget;

  return {
    includeSummary,
    includedTurns: request.unsummarisedTurns.slice(includedFromIndex),
    omittedTurnCount: includedFromIndex,
    tokenCount: request.historyBudgetTokens - remainingBudget + (includeSummary ? summaryTokenCount : 0),
    summariseThroughSequenceNumber:
      historyTokenCount > request.summaryThresholdTokens
        ? lastSequenceNumberBeforeRecentTurns(request.unsummarisedTurns, request.recentTurnCount)
        : null,
  };
}

function lastSequenceNumberBeforeRecentTurns(
  turns: readonly HistoryTurn[],
  recentTurnCount: number,
): number | null {
  const olderTurns = turns.slice(0, Math.max(0, turns.length - recentTurnCount));
  const lastMessage = olderTurns.at(-1)?.messages.at(-1);
  return lastMessage?.sequenceNumber ?? null;
}

function turnTokenCount(turn: HistoryTurn): number {
  return sum(turn.messages.map((message) => message.estimatedTokenCount));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
