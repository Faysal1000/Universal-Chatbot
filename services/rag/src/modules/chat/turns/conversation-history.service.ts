import { Injectable } from '@nestjs/common';

import type { HistoryTurn } from '../../../domain/chat/conversation-memory-planner.js';
import { ChatMessagesRepository, type ChatMessageRecord } from '../persistence/chat-messages.repository.js';
import {
  type ConversationSummaryRecord,
  ConversationSummariesRepository,
} from '../persistence/conversation-summaries.repository.js';

export interface ConversationHistory {
  readonly summary: ConversationSummaryRecord | undefined;
  /** Finished turns after the summary, oldest first. */
  readonly unsummarisedTurns: HistoryTurn[];
}

/** Loads what a prompt may remember of a conversation: the rolling summary and later turns. */
@Injectable()
export class ConversationHistoryService {
  constructor(
    private readonly chatMessagesRepository: ChatMessagesRepository,
    private readonly conversationSummariesRepository: ConversationSummariesRepository,
  ) {}

  async load(conversationId: string, currentTurnId: string): Promise<ConversationHistory> {
    const summary = await this.conversationSummariesRepository.find(conversationId);
    const messages = await this.chatMessagesRepository.loadHistory(
      conversationId,
      summary?.coveredThroughSequenceNumber ?? 0,
      currentTurnId,
    );
    return { summary, unsummarisedTurns: groupIntoTurns(messages) };
  }
}

/** Messages are ordered by sequence; a turn's user messages precede its reply. */
function groupIntoTurns(messages: readonly ChatMessageRecord[]): HistoryTurn[] {
  const turns: { turnId: string; messages: HistoryTurn['messages'][number][] }[] = [];
  for (const message of messages) {
    let turn = turns.find((candidate) => candidate.turnId === message.turnId);
    if (turn === undefined) {
      turn = { turnId: message.turnId, messages: [] };
      turns.push(turn);
    }
    turn.messages.push({
      role: message.role,
      content: message.content,
      sequenceNumber: message.sequenceNumber,
      estimatedTokenCount: message.estimatedTokenCount,
    });
  }
  return turns;
}
