import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../common/errors/application-error.js';
import { StreamingCitationMarkerRemover } from '../../../domain/chat/citation-markers.js';
import {
  LANGUAGE_MODEL_PORT,
  type LanguageModelFinishReason,
  type LanguageModelPort,
} from '../../../ports/language-model.port.js';
import { ANSWER_GENERATION_TASK, type AnswerPrompt } from './answer-prompt-assembler.js';
import { TurnControl } from './turn-control.js';
import { TurnEventLog } from './turn-event-log.js';
import { TurnInterruptedError } from './turn-interruption.js';
import type { GeneratedAnswer, TurnExecution } from './turn-execution.js';

/** Interruptions requested on another replica are noticed within this many deltas. */
const DELTAS_BETWEEN_INTERRUPTION_CHECKS = 20;

/** Partial output kept when a stream is cut off, so a stopped answer can be stored. */
export class PartialAnswer {
  content = '';
  reasoning = '';
  timeToFirstTokenMilliseconds: number | null = null;
  /** The prompt's estimated size, charged to the daily budget when the answer is stopped. */
  estimatedInputTokens = 0;
}

/**
 * Streams `answer_generation` from the gateway into the turn's event log: reasoning (when
 * the admin shows it) first, then answer text with inline `[n]` markers. When the admin hides
 * sources the markers are removed from what visitors see, but kept in the stored answer.
 */
@Injectable()
export class AnswerStreamer {
  constructor(
    private readonly turnEventLog: TurnEventLog,
    private readonly turnControl: TurnControl,
    @Inject(LANGUAGE_MODEL_PORT) private readonly languageModel: LanguageModelPort,
  ) {}

  async stream(
    execution: TurnExecution,
    prompt: AnswerPrompt,
    partial: PartialAnswer,
  ): Promise<GeneratedAnswer> {
    const { settings, turnId } = execution;
    const visibleText = new VisibleAnswerText(settings.showSources);
    let deltaCount = 0;
    const events = this.languageModel.stream(
      {
        task: ANSWER_GENERATION_TASK,
        messages: prompt.messages,
        maxOutputTokens: prompt.maxOutputTokens,
        temperature: settings.answerTemperature,
        ...(settings.reasoningEffort === 'off' ? {} : { reasoningEffort: settings.reasoningEffort }),
        ...(execution.requestId === undefined ? {} : { requestId: execution.requestId }),
      },
      execution.abortSignal,
    );
    for await (const event of events) {
      if (event.type === 'completed') {
        if (partial.content.trim() === '') throw new EmptyAnswerError(event.finishReason);
        await this.appendAnswerDelta(turnId, visibleText.flush());
        return {
          content: partial.content,
          reasoning: settings.showReasoning && partial.reasoning !== '' ? partial.reasoning : null,
          finishReason: event.finishReason === 'length' ? 'length' : 'stop',
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          reasoningTokens: event.usage.reasoningTokens,
          servedByModel: event.servedByModel,
          timeToFirstTokenMilliseconds: partial.timeToFirstTokenMilliseconds,
        };
      }
      deltaCount += 1;
      if (deltaCount % DELTAS_BETWEEN_INTERRUPTION_CHECKS === 0) await this.assertNotInterrupted(turnId);
      if (event.type === 'reasoning_delta') {
        partial.reasoning += event.text;
        if (settings.showReasoning) {
          await this.turnEventLog.append(turnId, 'reasoning.delta', { text: event.text });
        }
        continue;
      }
      if (partial.timeToFirstTokenMilliseconds === null) {
        partial.timeToFirstTokenMilliseconds = Math.round(
          performance.now() - execution.startedAtMilliseconds,
        );
        await this.turnControl.markAnswerStarted(turnId);
      }
      partial.content += event.text;
      await this.appendAnswerDelta(turnId, visibleText.push(event.text));
    }
    throw new Error('The answer stream ended without a completion event');
  }

  private async appendAnswerDelta(turnId: string, text: string): Promise<void> {
    if (text !== '') await this.turnEventLog.append(turnId, 'answer.delta', { text });
  }

  private async assertNotInterrupted(turnId: string): Promise<void> {
    const interruption = await this.turnControl.readInterruption(turnId);
    if (interruption !== undefined) throw new TurnInterruptedError(interruption);
  }
}

/** The model finished without answer text, e.g. it spent its whole output limit thinking. */
export class EmptyAnswerError extends ApplicationError {
  constructor(finishReason: LanguageModelFinishReason) {
    super(
      502,
      finishReason === 'length' ? 'answer_cut_off' : 'answer_empty',
      finishReason === 'length'
        ? 'The assistant used its whole answer limit before replying. Please try again.'
        : 'The assistant finished without an answer. Please try again.',
    );
  }
}

/** The answer text visitors are shown: as generated, or without `[n]` markers. */
class VisibleAnswerText {
  private readonly markerRemover: StreamingCitationMarkerRemover | undefined;

  constructor(showsSources: boolean) {
    this.markerRemover = showsSources ? undefined : new StreamingCitationMarkerRemover();
  }

  push(chunk: string): string {
    return this.markerRemover?.push(chunk) ?? chunk;
  }

  flush(): string {
    return this.markerRemover?.flush() ?? '';
  }
}
