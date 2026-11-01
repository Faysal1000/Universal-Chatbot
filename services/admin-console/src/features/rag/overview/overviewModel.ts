import { ERROR_STATUS_COLOR, categoricalSeriesColor } from '@/shared/charts/chartPalette';
import type { ChartData, ChartRow } from '@/shared/charts/chartTypes';
import {
  formatCompactNumber,
  formatDurationMilliseconds,
  formatInteger,
  formatPercentFromFraction,
} from '@/shared/lib/format';
import type { ManifestField } from '@/shared/ui/ManifestStrip';

import type { RagDailyTurnCounts, RagOverview } from './api/overviewTypes';

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** Share of ratings that are thumbs-up, or null before anyone rated. */
export function approvalShare(feedback: RagOverview['feedback']): number | null {
  const ratingCount = feedback.up + feedback.down;
  return ratingCount === 0 ? null : feedback.up / ratingCount;
}

/** Share of today's token budget already spent, or null when no budget is set. */
export function budgetShareSpent(todayBudget: RagOverview['todayBudget']): number | null {
  return todayBudget.budgetTokens > 0 ? todayBudget.spentTokens / todayBudget.budgetTokens : null;
}

function describeP99(p99: number | null): ManifestField['note'] {
  return p99 === null ? undefined : `p99 ${formatDurationMilliseconds(p99)}`;
}

/** The headline facts of the window, in reading order. Notes appear only when they add something. */
export function buildOverviewManifestFields(overview: RagOverview): ManifestField[] {
  const { turns, latencyMilliseconds, tokens, todayBudget, feedback } = overview;
  const approval = approvalShare(feedback);
  const budgetShare = budgetShareSpent(todayBudget);
  return [
    {
      label: 'Turns',
      value: formatInteger(turns.total),
      note: turns.failed > 0 ? `${formatInteger(turns.failed)} failed` : undefined,
    },
    { label: 'No-evidence rate', value: formatPercentFromFraction(turns.noEvidenceRate) },
    { label: 'New conversations', value: formatInteger(overview.newConversations) },
    {
      label: 'Positive feedback',
      value: approval === null ? '—' : formatPercentFromFraction(approval),
      note: approval === null ? undefined : `${formatInteger(feedback.up)} up, ${formatInteger(feedback.down)} down`,
    },
    { label: 'Tokens', value: formatCompactNumber(tokens.input + tokens.output) },
    {
      label: 'First token p90',
      value: formatDurationMilliseconds(latencyMilliseconds.timeToFirstTokenP90),
      note: describeP99(latencyMilliseconds.timeToFirstTokenP99),
    },
    {
      label: 'Full answer p90',
      value: formatDurationMilliseconds(latencyMilliseconds.totalP90),
      note: describeP99(latencyMilliseconds.totalP99),
    },
    {
      label: "Today's token budget",
      value: budgetShare === null ? 'No limit' : formatPercentFromFraction(budgetShare),
      note: budgetShare === null ? undefined : `${formatCompactNumber(todayBudget.budgetTokens)} tokens`,
    },
  ];
}

/** `YYYY-MM-DD` (a UTC calendar day) as local midnight, so axis labels show that same date. */
export function calendarDayToEpochMilliseconds(isoDate: string): number {
  const [year = 1970, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

function toUtcCalendarDay(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString().slice(0, 10);
}

/** Every UTC calendar day from the window's start through its end, inclusive. */
export function enumerateCalendarDays(window: RagOverview['window']): string[] {
  const firstDay = Date.parse(`${toUtcCalendarDay(Date.parse(window.from))}T00:00:00Z`);
  const lastDay = Date.parse(`${toUtcCalendarDay(Date.parse(window.to))}T00:00:00Z`);
  const days: string[] = [];
  for (let dayStart = firstDay; dayStart <= lastDay; dayStart += DAY_MILLISECONDS) {
    days.push(toUtcCalendarDay(dayStart));
  }
  return days;
}

const DAILY_TURN_SERIES = [
  { dataKey: 'answered', label: 'Answered or stopped', color: categoricalSeriesColor(0) },
  { dataKey: 'noEvidence', label: 'No evidence (fallback)', color: categoricalSeriesColor(1) },
  { dataKey: 'failed', label: 'Failed', color: ERROR_STATUS_COLOR },
] as const;

function toDailyTurnRow(isoDate: string, counts: RagDailyTurnCounts | undefined): ChartRow {
  const turnCount = counts?.turns ?? 0;
  const noEvidenceCount = counts?.noEvidence ?? 0;
  const failedCount = counts?.failed ?? 0;
  return {
    bucketEpochMilliseconds: calendarDayToEpochMilliseconds(isoDate),
    answered: Math.max(0, turnCount - noEvidenceCount - failedCount),
    noEvidence: noEvidenceCount,
    failed: failedCount,
  };
}

/** Daily turns split by outcome; days without turns appear as zero rather than a gap. */
export function buildDailyTurnChartData(overview: RagOverview): ChartData {
  const countsByDay = new Map(overview.daily.map((day) => [day.date, day]));
  return {
    rows: enumerateCalendarDays(overview.window).map((isoDate) => toDailyTurnRow(isoDate, countsByDay.get(isoDate))),
    series: DAILY_TURN_SERIES.map((series) => ({ ...series })),
  };
}

export function hasAnyTurns(overview: RagOverview): boolean {
  return overview.daily.some((day) => day.turns > 0);
}
