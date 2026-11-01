import { Inject, Injectable } from '@nestjs/common';

import { TokenEstimator } from '../../../domain/text/token-estimator.js';
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  LANGUAGE_MODEL_PORT,
  type LanguageModelPort,
} from '../../../ports/language-model.port.js';
import { type ChatMessageRecord, ChatMessagesRepository } from '../persistence/chat-messages.repository.js';
import { ConversationSummariesRepository } from '../persistence/conversation-summaries.repository.js';
import type { SummariseConversationPayload } from './summary-jobs.js';

const CONVERSATION_SUMMARY_TASK = 'conversation_summary';
const SUMMARY_OUTPUT_TOKENS = 600;
const INSTRUCTION_RESERVE_TOKENS = 400;

const SUMMARY_INSTRUCTIONS = [
  "You maintain the running summary of a conversation between a website visitor and an organisation's assistant.",
  'Merge the new messages into the current summary. Keep what the visitor told about themselves and their situation,',
  'the questions asked, the answers given (with the document names they cited) and anything still unresolved.',
  'Write at most 250 words, in the language the conversation uses. Reply with the summary text only.',
].join(' ');

/**
 * Folds older messages into a conversation's rolling summary with the gateway task
 * `conversation_summary`, in slices that fit the model, so a summary never needs the
 * whole transcript at once.
 */
@Injectable()
export class ConversationSummaryService {
  constructor(
    private readonly chatMessagesRepository: ChatMessagesRepository,
    private readonly conversationSummariesRepository: ConversationSummariesRepository,
    private readonly tokenEstimator: TokenEstimator,
    @Inject(LANGUAGE_MODEL_PORT) private readonly languageModel: LanguageModelPort,
  ) {}

  async summarise(payload: SummariseConversationPayload, requestId: string | undefined): Promise<void> {
    const existingSummary = await this.conversationSummariesRepository.find(payload.conversationId);
    const coveredThrough = existingSummary?.coveredThroughSequenceNumber ?? 0;
    if (coveredThrough >= payload.throughSequenceNumber) return;
    const messages = await this.chatMessagesRepository.loadHistory(
      payload.conversationId,
      coveredThrough,
      null,
      payload.throughSequenceNumber,
    );
    let summaryText = existingSummary?.summaryText ?? '';
    for (const slice of await this.sliceToFit(messages, summaryText)) {
      const completion = await this.languageModel.complete({
        task: CONVERSATION_SUMMARY_TASK,
        messages: [
          { role: 'system', content: SUMMARY_INSTRUCTIONS },
          { role: 'user', content: describeUpdate(summaryText, slice) },
        ],
        maxOutputTokens: SUMMARY_OUTPUT_TOKENS,
        temperature: 0,
        ...(requestId === undefined ? {} : { requestId }),
      });
      if (completion.finishReason === 'length' || completion.content.trim() === '') {
        throw new Error(
          `The summary model returned no complete summary (finish reason ${completion.finishReason})`,
        );
      }
      summaryText = completion.content.trim();
      const lastMessage = slice.at(-1);
      if (lastMessage === undefined) continue;
      await this.conversationSummariesRepository.upsert({
        conversationId: payload.conversationId,
        summaryText,
        coveredThroughSequenceNumber: lastMessage.sequenceNumber,
        coveredMessageId: lastMessage.id,
        estimatedTokenCount: this.tokenEstimator.estimateMessage(summaryText),
        servedByModel: completion.servedByModel,
      });
    }
  }

  /** Consecutive groups of messages that fit the model beside the current summary. */
  private async sliceToFit(
    messages: readonly ChatMessageRecord[],
    summaryText: string,
  ): Promise<ChatMessageRecord[][]> {
    const limits = await this.languageModel.getTaskTokenLimits(CONVERSATION_SUMMARY_TASK);
    const sliceBudget =
      (limits.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS) -
      SUMMARY_OUTPUT_TOKENS * 2 -
      INSTRUCTION_RESERVE_TOKENS -
      this.tokenEstimator.estimate(summaryText);
    const slices: ChatMessageRecord[][] = [];
    let currentSlice: ChatMessageRecord[] = [];
    let currentTokens = 0;
    for (const message of messages) {
      const messageTokens = Math.min(message.estimatedTokenCount, sliceBudget);
      if (currentSlice.length > 0 && currentTokens + messageTokens > sliceBudget) {
        slices.push(currentSlice);
        currentSlice = [];
        currentTokens = 0;
      }
      currentSlice.push({ ...message, content: this.tokenEstimator.truncate(message.content, sliceBudget) });
      currentTokens += messageTokens;
    }
    if (currentSlice.length > 0) slices.push(currentSlice);
    return slices;
  }
}

function describeUpdate(summaryText: string, messages: readonly ChatMessageRecord[]): string {
  const transcript = messages
    .map((message) => `${message.role === 'user' ? 'Visitor' : 'Assistant'}: ${message.content}`)
    .join('\n');
  return `Current summary:\n${summaryText === '' ? '(none yet)' : summaryText}\n\nNew messages:\n${transcript}`;
}
