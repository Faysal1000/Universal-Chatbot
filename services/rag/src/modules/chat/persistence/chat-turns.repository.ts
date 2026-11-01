import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';

import { ApplicationError } from '../../../common/errors/application-error.js';
import { DATABASE, type Database } from '../../../database/database.tokens.js';
import { chatAttachments, type ChatTurnStatus, chatMessages, chatTurns } from '../../../database/schema.js';

export type ChatTurnRecord = typeof chatTurns.$inferSelect;
export type NewChatTurnRecord = typeof chatTurns.$inferInsert;

/** Turns whose messages no longer belong to the visible conversation. */
export const HIDDEN_TURN_STATUSES: readonly ChatTurnStatus[] = ['superseded', 'replaced'];
const ACTIVE_TURN_STATUSES: readonly ChatTurnStatus[] = ['pending', 'running'];

export interface TurnStart {
  readonly turn: NewChatTurnRecord & { readonly id: string };
  readonly userMessages: readonly Omit<typeof chatMessages.$inferInsert, 'turnId' | 'role'>[];
  readonly supersedeTurnId?: string;
  readonly replaceTurnId?: string;
  /** Uploaded attachments to bind to the stored user messages (they stop expiring). */
  readonly attachmentLinks: readonly {
    readonly clientMessageId: string;
    readonly attachmentIds: readonly string[];
  }[];
}

export interface StartedTurn {
  readonly turn: ChatTurnRecord;
  readonly userMessages: readonly { readonly id: string; readonly clientMessageId: string | null }[];
}

export interface TurnOutcome {
  readonly status: Extract<ChatTurnStatus, 'completed' | 'cancelled' | 'failed'>;
  readonly finishReason: ChatTurnRecord['finishReason'];
  readonly failureCode?: string | null;
  readonly servedByModel: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly timeToFirstTokenMilliseconds: number | null;
  readonly totalMilliseconds: number;
}

@Injectable()
export class ChatTurnsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findById(turnId: string): Promise<ChatTurnRecord | undefined> {
    const [turn] = await this.database.select().from(chatTurns).where(eq(chatTurns.id, turnId));
    return turn;
  }

  async findActive(conversationId: string): Promise<ChatTurnRecord | undefined> {
    const [turn] = await this.database
      .select()
      .from(chatTurns)
      .where(
        and(
          eq(chatTurns.conversationId, conversationId),
          inArray(chatTurns.status, [...ACTIVE_TURN_STATUSES]),
        ),
      );
    return turn;
  }

  /** The newest turn still visible in the conversation (the only one `replacesTurnId` may name). */
  async findLatestVisible(conversationId: string): Promise<ChatTurnRecord | undefined> {
    const [turn] = await this.database
      .select()
      .from(chatTurns)
      .where(
        and(
          eq(chatTurns.conversationId, conversationId),
          notInArray(chatTurns.status, [...HIDDEN_TURN_STATUSES]),
        ),
      )
      .orderBy(desc(chatTurns.createdAt))
      .limit(1);
    return turn;
  }

  async insert(turn: NewChatTurnRecord): Promise<ChatTurnRecord> {
    const [inserted] = await this.database.insert(chatTurns).values(turn).returning();
    if (inserted === undefined) throw new Error('Inserting a chat turn returned no row');
    return inserted;
  }

  async markRunning(turnId: string, chatbotSettingsVersion: number): Promise<void> {
    await this.database
      .update(chatTurns)
      .set({ status: 'running', chatbotSettingsVersion })
      .where(eq(chatTurns.id, turnId));
  }

  async recordRewrittenQueries(turnId: string, rewrittenQueries: readonly string[]): Promise<void> {
    await this.database
      .update(chatTurns)
      .set({ rewrittenQueries: [...rewrittenQueries] })
      .where(eq(chatTurns.id, turnId));
  }

  /** Returns false when the turn already left the pending/running states (superseded meanwhile). */
  async recordOutcome(turnId: string, outcome: TurnOutcome): Promise<boolean> {
    const updated = await this.database
      .update(chatTurns)
      .set({ ...outcome, completedAt: new Date() })
      .where(and(eq(chatTurns.id, turnId), inArray(chatTurns.status, [...ACTIVE_TURN_STATUSES])))
      .returning({ id: chatTurns.id });
    return updated.length > 0;
  }

  /**
   * Starts a turn in one transaction: optionally hides the turn it supersedes (moving that
   * turn's user messages into the new one, so a single reply answers both) or replaces,
   * then stores the new turn and its user messages. Returns undefined when the turn to
   * supersede already left the pending/running states, so the caller can answer 409.
   */
  async start(start: TurnStart): Promise<StartedTurn | undefined> {
    return this.database.transaction(async (transaction) => {
      if (start.supersedeTurnId !== undefined) {
        const superseded = await transaction
          .update(chatTurns)
          .set({ status: 'superseded', supersededByTurnId: start.turn.id, completedAt: new Date() })
          .where(
            and(
              eq(chatTurns.id, start.supersedeTurnId),
              inArray(chatTurns.status, [...ACTIVE_TURN_STATUSES]),
            ),
          )
          .returning({ id: chatTurns.id });
        if (superseded.length === 0) return undefined;
      }
      if (start.replaceTurnId !== undefined) {
        await transaction
          .update(chatTurns)
          .set({ status: 'replaced' })
          .where(eq(chatTurns.id, start.replaceTurnId));
      }
      const [turn] = await transaction.insert(chatTurns).values(start.turn).returning();
      if (turn === undefined) throw new Error('Inserting a chat turn returned no row');
      if (start.supersedeTurnId !== undefined) {
        await transaction
          .update(chatMessages)
          .set({ turnId: turn.id })
          .where(and(eq(chatMessages.turnId, start.supersedeTurnId), eq(chatMessages.role, 'user')));
        await transaction.delete(chatMessages).where(eq(chatMessages.turnId, start.supersedeTurnId));
      }
      const userMessages =
        start.userMessages.length === 0
          ? []
          : await transaction
              .insert(chatMessages)
              .values(
                start.userMessages.map((message) => ({ ...message, turnId: turn.id, role: 'user' as const })),
              )
              .returning({ id: chatMessages.id, clientMessageId: chatMessages.clientMessageId });
      for (const link of start.attachmentLinks) {
        const message = userMessages.find((stored) => stored.clientMessageId === link.clientMessageId);
        if (message === undefined || link.attachmentIds.length === 0) continue;
        const bound = await transaction
          .update(chatAttachments)
          .set({ messageId: message.id, expiresAt: null })
          .where(and(inArray(chatAttachments.id, [...link.attachmentIds]), isNull(chatAttachments.messageId)))
          .returning({ id: chatAttachments.id });
        if (bound.length < new Set(link.attachmentIds).size) throw attachmentAlreadyUsedError();
      }
      return { turn, userMessages };
    });
  }

  async listForConversation(conversationId: string): Promise<ChatTurnRecord[]> {
    return this.database
      .select()
      .from(chatTurns)
      .where(eq(chatTurns.conversationId, conversationId))
      .orderBy(chatTurns.createdAt);
  }
}

/** Another turn bound the attachment between validation and this transaction. */
function attachmentAlreadyUsedError(): ApplicationError {
  return new ApplicationError(422, 'validation_failed', 'The request is invalid.', {
    fieldErrors: [
      { field: 'messages.attachmentIds', message: 'Unknown, expired or already used attachment.' },
    ],
  });
}
