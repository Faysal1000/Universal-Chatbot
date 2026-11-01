import { Inject, Injectable } from '@nestjs/common';

import { planConversationMemory } from '../../../domain/chat/conversation-memory-planner.js';
import {
  buildGroundedPrompt,
  fixedPromptText,
  type PromptSource,
  type PromptUserMessage,
} from '../../../domain/chat/grounded-prompt.js';
import { TokenEstimator } from '../../../domain/text/token-estimator.js';
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  LANGUAGE_MODEL_PORT,
  type LanguageModelMessage,
  type LanguageModelPort,
} from '../../../ports/language-model.port.js';
import type { ChatbotSettingsRecord } from '../../chatbot-settings/chatbot-settings.repository.js';
import type { RetrievedSource } from '../../retrieval/retrieval.service.js';
import type { ConversationHistory } from './conversation-history.service.js';

export const ANSWER_GENERATION_TASK = 'answer_generation';
/** Rough prompt cost of one attached image across vision models. */
const IMAGE_TOKEN_ESTIMATE = 1_000;
/** Slack for chat-template tokens the estimate cannot see. */
const PROMPT_SAFETY_MARGIN_TOKENS = 64;
/**
 * Models that think before answering spend output tokens on it, so the model may use up to
 * this many times the admin's answer length when the context window has room left.
 */
const OUTPUT_HEADROOM_FACTOR = 4;

export interface AnswerPromptRequest {
  readonly settings: ChatbotSettingsRecord;
  readonly sources: readonly PromptSource[];
  readonly currentMessages: readonly PromptUserMessage[];
  readonly history: ConversationHistory;
}

export interface AnswerPrompt {
  readonly messages: LanguageModelMessage[];
  readonly maxOutputTokens: number;
  readonly estimatedInputTokens: number;
  /** Sources that fit; the model can cite only these. */
  readonly sources: readonly PromptSource[];
  readonly omittedHistoryTurnCount: number;
  /** Set when older history should be folded into the rolling summary. */
  readonly summariseThroughSequenceNumber: number | null;
}

/**
 * Fits the answer prompt into the model's context window: the admin's answer length is
 * reserved first, then the fixed parts (rules, instruction, sources, the new messages), and
 * history gets what is left. Sources are dropped from the bottom only if the fixed parts
 * alone overflow. Whatever the prompt leaves unused goes to the output, up to the headroom.
 */
@Injectable()
export class AnswerPromptAssembler {
  constructor(
    private readonly tokenEstimator: TokenEstimator,
    @Inject(LANGUAGE_MODEL_PORT) private readonly languageModel: LanguageModelPort,
  ) {}

  async assemble(request: AnswerPromptRequest): Promise<AnswerPrompt> {
    const limits = await this.languageModel.getTaskTokenLimits(ANSWER_GENERATION_TASK);
    const contextWindowTokens = limits.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    const outputLimitTokens = limits.maxOutputTokens ?? Infinity;
    const answerReserveTokens = Math.min(request.settings.maxAnswerTokens, outputLimitTokens);
    const inputBudgetTokens = contextWindowTokens - answerReserveTokens - PROMPT_SAFETY_MARGIN_TOKENS;
    const sources = this.fitSources(request, inputBudgetTokens);
    const fixedTokens = this.estimateFixedTokens(request, sources);
    const { summary, unsummarisedTurns } = request.history;
    const memoryPlan = planConversationMemory({
      unsummarisedTurns,
      summaryTokenCount: summary?.estimatedTokenCount ?? null,
      historyBudgetTokens: Math.max(0, inputBudgetTokens - fixedTokens),
      summaryThresholdTokens: Math.floor(inputBudgetTokens * request.settings.memorySummaryThresholdRatio),
      recentTurnCount: request.settings.memoryRecentTurnCount,
    });
    const unusedContextTokens =
      contextWindowTokens - fixedTokens - memoryPlan.tokenCount - PROMPT_SAFETY_MARGIN_TOKENS;
    const maxOutputTokens = Math.max(
      answerReserveTokens,
      Math.min(outputLimitTokens, unusedContextTokens, answerReserveTokens * OUTPUT_HEADROOM_FACTOR),
    );
    return {
      messages: buildGroundedPrompt({
        botName: request.settings.botName,
        adminInstruction: request.settings.systemInstruction,
        sources,
        conversationSummary: memoryPlan.includeSummary ? (summary?.summaryText ?? null) : null,
        historyTurns: memoryPlan.includedTurns,
        currentMessages: request.currentMessages,
      }),
      maxOutputTokens,
      estimatedInputTokens: fixedTokens + memoryPlan.tokenCount,
      sources,
      omittedHistoryTurnCount: memoryPlan.omittedTurnCount,
      summariseThroughSequenceNumber: memoryPlan.summariseThroughSequenceNumber,
    };
  }

  private fitSources(request: AnswerPromptRequest, inputBudgetTokens: number): PromptSource[] {
    const sources = [...request.sources];
    while (sources.length > 1 && this.estimateFixedTokens(request, sources) > inputBudgetTokens) {
      sources.pop();
    }
    return sources;
  }

  private estimateFixedTokens(request: AnswerPromptRequest, sources: readonly PromptSource[]): number {
    const imageCount = request.currentMessages.reduce(
      (total, message) => total + message.imageDataUrls.length,
      0,
    );
    const text = fixedPromptText({
      botName: request.settings.botName,
      adminInstruction: request.settings.systemInstruction,
      sources,
      currentMessages: request.currentMessages,
    });
    return this.tokenEstimator.estimate(text) + imageCount * IMAGE_TOKEN_ESTIMATE;
  }
}

/** Numbers retrieved sources 1..n in rank order, as the model cites them. */
export function promptSourceOf(source: RetrievedSource, index: number): PromptSource {
  return {
    sourceNumber: index + 1,
    documentTitle: source.chunk.documentTitle,
    pageStart: source.chunk.pageStart,
    pageEnd: source.chunk.pageEnd,
    contextualHeader: source.chunk.contextualHeader,
    text: source.chunk.text,
  };
}
