import { Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../common/errors/application-error.js';
import type { ServerSentEventStream } from '../../../common/http/server-sent-events.js';
import { removeCitationMarkers } from '../../../domain/chat/citation-markers.js';
import { ChatbotSettingsService } from '../../chatbot-settings/chatbot-settings.service.js';
import type { VisitorPrincipal } from '../../public-access/visitor-principal.js';
import { ChatMessagesRepository } from '../persistence/chat-messages.repository.js';
import { type ChatTurnRecord, ChatTurnsRepository } from '../persistence/chat-turns.repository.js';
import { ConversationsRepository } from '../persistence/conversations.repository.js';
import { MessageCitationsRepository } from '../persistence/message-citations.repository.js';
import { presentCitation } from './citation-assembler.js';
import { RunningTurnsRegistry } from './running-turns.registry.js';
import { TurnControl } from './turn-control.js';
import { TurnEventLog } from './turn-event-log.js';
import type { TurnStreamEventName, TurnStreamEventPayloads } from './turn-stream-events.js';

const FINISHED_TURN_STATUSES: ReadonlySet<ChatTurnRecord['status']> = new Set(['completed', 'cancelled']);

/** Serves a turn's events over SSE (live, resumed or replayed) and handles cancellation. */
@Injectable()
export class TurnStreamService {
  constructor(
    private readonly turnEventLog: TurnEventLog,
    private readonly runningTurns: RunningTurnsRegistry,
    private readonly turnControl: TurnControl,
    private readonly conversationsRepository: ConversationsRepository,
    private readonly chatTurnsRepository: ChatTurnsRepository,
    private readonly chatMessagesRepository: ChatMessagesRepository,
    private readonly messageCitationsRepository: MessageCitationsRepository,
    private readonly chatbotSettings: ChatbotSettingsService,
  ) {}

  /** Throws 404 unless the turn exists in a conversation of this visitor. */
  async findOwnedTurn(
    visitor: VisitorPrincipal,
    conversationId: string,
    turnId: string,
  ): Promise<ChatTurnRecord> {
    const conversation = await this.conversationsRepository.findOwned(
      conversationId,
      visitor.visitorSessionId,
    );
    const turn = conversation === undefined ? undefined : await this.chatTurnsRepository.findById(turnId);
    if (turn?.conversationId !== conversationId) {
      throw new ApplicationError(404, 'not_found', 'No turn has this id.');
    }
    return turn;
  }

  /**
   * Sends events after `afterSequence`. Buffered events expire 10 minutes after the turn;
   * a finished turn is then rebuilt from the database, anything else is gone (404).
   */
  async stream(
    turn: ChatTurnRecord,
    afterSequence: number,
    openEventStream: () => ServerSentEventStream,
  ): Promise<void> {
    if (!(await this.turnEventLog.exists(turn.id))) {
      if (!FINISHED_TURN_STATUSES.has(turn.status)) {
        throw new ApplicationError(404, 'not_found', 'The events of this turn are no longer available.');
      }
      await this.replayFinishedTurn(turn, openEventStream);
      return;
    }
    const eventStream = openEventStream();
    const clientGone = new AbortController();
    eventStream.onClose(() => {
      clientGone.abort();
    });
    this.runningTurns.readerConnected(turn.id);
    try {
      for await (const event of this.turnEventLog.read(turn.id, afterSequence, clientGone.signal)) {
        eventStream.send(event.name, event.data, event.sequence);
      }
    } finally {
      this.runningTurns.readerDisconnected(turn.id);
      eventStream.end();
    }
  }

  async cancel(turn: ChatTurnRecord): Promise<void> {
    if (turn.status !== 'pending' && turn.status !== 'running') return;
    const interruption = { kind: 'cancelled' as const };
    if (!this.runningTurns.interrupt(turn.id, interruption)) {
      await this.turnControl.requestInterruption(turn.id, interruption);
    }
  }

  private async replayFinishedTurn(
    turn: ChatTurnRecord,
    openEventStream: () => ServerSentEventStream,
  ): Promise<void> {
    const messages = await this.chatMessagesRepository.listTurnMessages(turn.id);
    const assistantMessage = messages.find((message) => message.role === 'assistant');
    if (assistantMessage === undefined) {
      throw new ApplicationError(404, 'not_found', 'The turn has no reply.');
    }
    const { showSources } = await this.chatbotSettings.getActive();
    const answerText = showSources
      ? assistantMessage.content
      : removeCitationMarkers(assistantMessage.content);
    const events = replayEvents(turn, assistantMessage.id, answerText, messages);
    if (showSources) {
      const citations = await this.messageCitationsRepository.listForMessages([assistantMessage.id]);
      events.push(['answer.citations', { citations: citations.map(presentCitation) }]);
    }
    events.push([
      'message.completed',
      {
        assistantMessageId: assistantMessage.id,
        finishReason: turn.finishReason ?? 'stop',
        usage: { inputTokens: turn.inputTokens, outputTokens: turn.outputTokens },
        timings: { ttftMs: turn.timeToFirstTokenMilliseconds ?? 0, totalMs: turn.totalMilliseconds ?? 0 },
      },
    ]);
    const eventStream = openEventStream();
    events.forEach(([name, data], index) => {
      eventStream.send(name, data, index + 1);
    });
    eventStream.end();
  }
}

type ReplayEvent = {
  [Name in TurnStreamEventName]: [Name, TurnStreamEventPayloads[Name]];
}[TurnStreamEventName];

function replayEvents(
  turn: ChatTurnRecord,
  assistantMessageId: string,
  answerText: string,
  messages: readonly { id: string; role: string; clientMessageId: string | null }[],
): ReplayEvent[] {
  return [
    [
      'message.started',
      {
        turnId: turn.id,
        conversationId: turn.conversationId,
        assistantMessageId,
        userMessages: messages
          .filter((message) => message.role === 'user')
          .map((message) => ({ clientMessageId: message.clientMessageId ?? message.id, id: message.id })),
      },
    ],
    ['answer.delta', { text: answerText }],
  ];
}
