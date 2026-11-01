import { Inject, Injectable } from '@nestjs/common';
import { and, type AnyColumn, count, eq, gte, type SQL, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import {
  chatTurns,
  conversations,
  documents,
  messageFeedback,
  visitorSessions,
} from '../../database/schema.js';

export interface TurnTotals {
  readonly turns: number;
  readonly answered: number;
  readonly noEvidence: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LatencyPercentiles {
  readonly timeToFirstTokenP90: number | null;
  readonly timeToFirstTokenP99: number | null;
  readonly totalP90: number | null;
  readonly totalP99: number | null;
}

export interface DailyTurnCounts {
  readonly date: string;
  readonly turns: number;
  readonly noEvidence: number;
  readonly failed: number;
}

/** Turns the visitor saw an outcome for; superseded and replaced turns were never shown. */
const SHOWN_TURN_STATUSES = sql`${chatTurns.status} IN ('completed', 'cancelled', 'failed')`;

/** Aggregates for the admin dashboard, computed on demand (the data set is small). */
@Injectable()
export class AnalyticsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async turnTotals(since: Date): Promise<TurnTotals> {
    const [totals] = await this.database
      .select({
        turns: count(),
        answered: countWhere(sql`${chatTurns.finishReason} IN ('stop', 'length')`),
        noEvidence: countWhere(sql`${chatTurns.finishReason} = 'no_evidence'`),
        cancelled: countWhere(sql`${chatTurns.status} = 'cancelled'`),
        failed: countWhere(sql`${chatTurns.status} = 'failed'`),
        inputTokens: sql<number>`coalesce(sum(${chatTurns.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${chatTurns.outputTokens}), 0)::int`,
      })
      .from(chatTurns)
      .where(and(gte(chatTurns.createdAt, since), SHOWN_TURN_STATUSES));
    return (
      totals ?? {
        turns: 0,
        answered: 0,
        noEvidence: 0,
        cancelled: 0,
        failed: 0,
        inputTokens: 0,
        outputTokens: 0,
      }
    );
  }

  /** Over answers the model generated; the instant no-evidence fallback would skew them. */
  async answerLatency(since: Date): Promise<LatencyPercentiles> {
    const [latency] = await this.database
      .select({
        timeToFirstTokenP90: percentile(0.9, chatTurns.timeToFirstTokenMilliseconds),
        timeToFirstTokenP99: percentile(0.99, chatTurns.timeToFirstTokenMilliseconds),
        totalP90: percentile(0.9, chatTurns.totalMilliseconds),
        totalP99: percentile(0.99, chatTurns.totalMilliseconds),
      })
      .from(chatTurns)
      .where(and(gte(chatTurns.createdAt, since), sql`${chatTurns.finishReason} IN ('stop', 'length')`));
    return (
      latency ?? { timeToFirstTokenP90: null, timeToFirstTokenP99: null, totalP90: null, totalP99: null }
    );
  }

  async dailyTurnCounts(since: Date): Promise<DailyTurnCounts[]> {
    const day = sql<string>`to_char(date_trunc('day', ${chatTurns.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
    return this.database
      .select({
        date: day,
        turns: count(),
        noEvidence: countWhere(sql`${chatTurns.finishReason} = 'no_evidence'`),
        failed: countWhere(sql`${chatTurns.status} = 'failed'`),
      })
      .from(chatTurns)
      .where(and(gte(chatTurns.createdAt, since), SHOWN_TURN_STATUSES))
      .groupBy(day)
      .orderBy(day);
  }

  async feedbackCounts(since: Date): Promise<{ up: number; down: number }> {
    const [feedback] = await this.database
      .select({
        up: countWhere(sql`${messageFeedback.rating} = 'up'`),
        down: countWhere(sql`${messageFeedback.rating} = 'down'`),
      })
      .from(messageFeedback)
      .where(gte(messageFeedback.updatedAt, since));
    return feedback ?? { up: 0, down: 0 };
  }

  async newConversationCount(since: Date): Promise<number> {
    const [result] = await this.database
      .select({ total: count() })
      .from(conversations)
      .where(gte(conversations.createdAt, since));
    return result?.total ?? 0;
  }

  async newVisitorSessionCount(since: Date): Promise<number> {
    const [result] = await this.database
      .select({ total: count() })
      .from(visitorSessions)
      .where(gte(visitorSessions.createdAt, since));
    return result?.total ?? 0;
  }

  async documentCountsByStatus(): Promise<{ status: string; total: number; enabled: number }[]> {
    return this.database
      .select({
        status: documents.status,
        total: count(),
        enabled: countWhere(eq(documents.isEnabled, true)),
      })
      .from(documents)
      .groupBy(documents.status)
      .orderBy(documents.status);
  }
}

function countWhere(condition: SQL) {
  return sql<number>`(count(*) FILTER (WHERE ${condition}))::int`;
}

function percentile(fraction: number, column: AnyColumn) {
  return sql<
    number | null
  >`round(percentile_cont(${fraction}) WITHIN GROUP (ORDER BY ${column}))::int`.mapWith((value: unknown) =>
    value === null ? null : Number(value),
  );
}
