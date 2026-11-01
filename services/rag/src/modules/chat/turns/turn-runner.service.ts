import { Inject, Injectable, Logger } from '@nestjs/common';

import type { PromptUserMessage } from '../../../domain/chat/grounded-prompt.js';
import { TokenEstimator } from '../../../domain/text/token-estimator.js';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../../ports/object-storage.port.js';
import { type RetrievedSource, RetrievalService } from '../../retrieval/retrieval.service.js';
import { ChatTurnsRepository } from '../persistence/chat-turns.repository.js';
import { RetrievalTracesRepository } from '../persistence/retrieval-traces.repository.js';
import { AnswerPromptAssembler, promptSourceOf } from './answer-prompt-assembler.js';
import { AnswerStreamer, PartialAnswer } from './answer-streamer.js';
import { CitationAssembler } from './citation-assembler.js';
import { type ConversationHistory, ConversationHistoryService } from './conversation-history.service.js';
import { QueryRewriteService } from './query-rewrite.service.js';
import { RunningTurnsRegistry } from './running-turns.registry.js';
import { TurnCompletionService } from './turn-completion.service.js';
import { TurnControl } from './turn-control.js';
import { TurnEventLog } from './turn-event-log.js';
import type { GeneratedAnswer, TurnExecution } from './turn-execution.js';
import { interruptionOf, type TurnInterruption, TurnInterruptedError } from './turn-interruption.js';

interface TurnImages {
  /** Raw Base64 per message, in message order, for retrieval. */
  readonly base64ByMessage: readonly (readonly string[])[];
}

/**
 * Answers one stored turn and writes every step to its event log: rewrite the batch
 * into search queries, retrieve sources, then either the no-evidence fallback or a
 * streamed answer, cited when sources were found. Runs detached from the HTTP request
 * that submitted it.
 */
@Injectable()
export class TurnRunnerService {
  private readonly logger = new Logger(TurnRunnerService.name);

  constructor(
    private readonly turnEventLog: TurnEventLog,
    private readonly turnControl: TurnControl,
    private readonly runningTurns: RunningTurnsRegistry,
    private readonly chatTurnsRepository: ChatTurnsRepository,
    private readonly retrievalTracesRepository: RetrievalTracesRepository,
    private readonly conversationHistory: ConversationHistoryService,
    private readonly queryRewrite: QueryRewriteService,
    private readonly retrieval: RetrievalService,
    private readonly answerPromptAssembler: AnswerPromptAssembler,
    private readonly answerStreamer: AnswerStreamer,
    private readonly citationAssembler: CitationAssembler,
    private readonly turnCompletion: TurnCompletionService,
    private readonly tokenEstimator: TokenEstimator,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStorage: ObjectStoragePort,
  ) {}

  /** Never rejects: every outcome, failures included, ends up in the event log. */
  async run(execution: TurnExecution): Promise<void> {
    const partial = new PartialAnswer();
    let sources: readonly RetrievedSource[] = [];
    try {
      await this.chatTurnsRepository.markRunning(execution.turnId, execution.settings.version);
      const history = await this.conversationHistory.load(execution.conversation.id, execution.turnId);
      const images = await this.loadImages(execution);
      const searchQueries = await this.rewriteQueries(execution, history);
      const retrieval = await this.retrieveSources(execution, searchQueries, images);
      if (retrieval.outcome === 'no_evidence' && execution.settings.answerOnlyFromDocuments) {
        await this.answerWithFallback(execution);
        return;
      }
      await this.announceStage(execution, 'generating');
      const prompt = await this.answerPromptAssembler.assemble({
        settings: execution.settings,
        sources: retrieval.sources.map(promptSourceOf),
        currentMessages: toPromptMessages(execution, images),
        history,
      });
      sources = retrieval.sources.slice(0, prompt.sources.length);
      partial.estimatedInputTokens = prompt.estimatedInputTokens;
      const answer = await this.answerStreamer.stream(execution, prompt, partial);
      const citations = await this.citationAssembler.storeCitations(
        execution.assistantMessageId,
        answer.content,
        sources,
      );
      const isRecorded = await this.turnCompletion.complete(
        execution,
        answer,
        citations,
        prompt.summariseThroughSequenceNumber,
      );
      if (!isRecorded) await this.announceSuperseded(execution);
    } catch (error: unknown) {
      await this.handleError(execution, error, partial, sources);
    } finally {
      this.runningTurns.unregister(execution.turnId);
    }
  }

  private async rewriteQueries(execution: TurnExecution, history: ConversationHistory): Promise<string[]> {
    const currentMessageTexts = execution.userMessages.map((message) => message.content);
    const request = {
      recentTurns: history.unsummarisedTurns,
      currentMessageTexts,
      requestId: execution.requestId,
      abortSignal: execution.abortSignal,
    };
    if (this.queryRewrite.needsRewriting(request)) await this.announceStage(execution, 'rewriting');
    const searchQueries = await this.queryRewrite.rewrite(request);
    await this.chatTurnsRepository.recordRewrittenQueries(execution.turnId, searchQueries);
    await this.throwIfInterrupted(execution);
    return searchQueries;
  }

  private async retrieveSources(execution: TurnExecution, searchQueries: string[], images: TurnImages) {
    await this.announceStage(execution, 'retrieving');
    const retrieval = await this.retrieval.retrieve({
      searchQueries,
      queryImagesBase64: images.base64ByMessage.flat(),
      maxSources: execution.settings.maxSources,
      minSimilarity: execution.settings.minSimilarity,
      abortSignal: execution.abortSignal,
    });
    await this.retrievalTracesRepository.upsert(execution.turnId, retrieval.trace);
    await this.throwIfInterrupted(execution);
    return retrieval;
  }

  /** Nothing relevant enough was found: the admin's fallback message, without a model call. */
  private async answerWithFallback(execution: TurnExecution): Promise<void> {
    const fallbackMessage = execution.settings.fallbackMessage;
    await this.turnEventLog.append(execution.turnId, 'answer.delta', { text: fallbackMessage });
    const answer: GeneratedAnswer = {
      content: fallbackMessage,
      reasoning: null,
      finishReason: 'no_evidence',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      servedByModel: null,
      timeToFirstTokenMilliseconds: Math.round(performance.now() - execution.startedAtMilliseconds),
    };
    if (!(await this.turnCompletion.complete(execution, answer, [], null))) {
      await this.announceSuperseded(execution);
    }
  }

  /** The turn was superseded after its last interruption check; its stream still has to close. */
  private async announceSuperseded(execution: TurnExecution): Promise<void> {
    const interruption = await this.turnControl.readInterruption(execution.turnId);
    if (interruption?.kind !== 'superseded') return;
    await this.turnEventLog.append(execution.turnId, 'turn.superseded', {
      supersededByTurnId: interruption.supersededByTurnId,
    });
  }

  private async handleError(
    execution: TurnExecution,
    error: unknown,
    partial: PartialAnswer,
    sources: readonly RetrievedSource[],
  ): Promise<void> {
    try {
      const interruption =
        error instanceof TurnInterruptedError ? error.interruption : interruptionOf(execution.abortSignal);
      if (interruption === undefined) {
        await this.turnCompletion.fail(execution, error, partial.content);
      } else {
        await this.handleInterruption(execution, interruption, partial, sources);
      }
    } catch (persistenceError: unknown) {
      this.logger.error(
        { err: persistenceError, turnId: execution.turnId },
        'Could not record the turn outcome',
      );
    }
  }

  private async handleInterruption(
    execution: TurnExecution,
    interruption: TurnInterruption,
    partial: PartialAnswer,
    sources: readonly RetrievedSource[],
  ): Promise<void> {
    if (interruption.kind === 'superseded') {
      // The superseding turn already took over the messages; this stream just closes.
      await this.turnEventLog.append(execution.turnId, 'turn.superseded', {
        supersededByTurnId: interruption.supersededByTurnId,
      });
      return;
    }
    const citations = await this.citationAssembler.storeCitations(
      execution.assistantMessageId,
      partial.content,
      sources,
    );
    await this.turnCompletion.complete(
      execution,
      {
        content: partial.content,
        reasoning: execution.settings.showReasoning && partial.reasoning !== '' ? partial.reasoning : null,
        finishReason: 'cancelled',
        inputTokens: partial.estimatedInputTokens,
        outputTokens: this.tokenEstimator.estimate(partial.content + partial.reasoning),
        reasoningTokens: 0,
        servedByModel: null,
        timeToFirstTokenMilliseconds: partial.timeToFirstTokenMilliseconds,
      },
      citations,
      null,
    );
  }

  private async announceStage(execution: TurnExecution, stage: 'rewriting' | 'retrieving' | 'generating') {
    await this.turnEventLog.append(execution.turnId, 'status', { stage });
  }

  /** Picks up a cancel or supersede requested on another replica between stages. */
  private async throwIfInterrupted(execution: TurnExecution): Promise<void> {
    const localInterruption = interruptionOf(execution.abortSignal);
    const interruption = localInterruption ?? (await this.turnControl.readInterruption(execution.turnId));
    if (interruption !== undefined) throw new TurnInterruptedError(interruption);
  }

  private async loadImages(execution: TurnExecution): Promise<TurnImages> {
    const base64ByMessage = await Promise.all(
      execution.userMessages.map((message) =>
        Promise.all(
          message.attachments.map(async (attachment) =>
            (await this.objectStorage.readBytes(attachment.storageKey)).toString('base64'),
          ),
        ),
      ),
    );
    return { base64ByMessage };
  }
}

function toPromptMessages(execution: TurnExecution, images: TurnImages): PromptUserMessage[] {
  return execution.userMessages.map((message, messageIndex) => ({
    text: message.content,
    imageDataUrls: message.attachments.map(
      (attachment, imageIndex) =>
        `data:${attachment.mimeType};base64,${images.base64ByMessage[messageIndex]?.[imageIndex] ?? ''}`,
    ),
  }));
}
