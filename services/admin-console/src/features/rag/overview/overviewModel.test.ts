import type { RagOverview } from './api/overviewTypes';
import {
  approvalShare,
  budgetShareSpent,
  buildDailyTurnChartData,
  buildOverviewManifestFields,
  calendarDayToEpochMilliseconds,
  enumerateCalendarDays,
} from './overviewModel';

function anOverview(overrides: Partial<RagOverview> = {}): RagOverview {
  return {
    window: { from: '2026-10-28T10:00:00Z', to: '2026-10-30T10:00:00Z', days: 2 },
    turns: { total: 10, answered: 7, noEvidence: 2, cancelled: 0, failed: 1, noEvidenceRate: 2 / 9 },
    latencyMilliseconds: { timeToFirstTokenP90: 820, timeToFirstTokenP99: 1900, totalP90: 4100, totalP99: 9000 },
    tokens: { input: 12_000, output: 3_000 },
    todayBudget: { spentTokens: 500, budgetTokens: 1000 },
    feedback: { up: 3, down: 1 },
    newConversations: 4,
    newVisitorSessions: 3,
    daily: [{ date: '2026-10-29', turns: 10, noEvidence: 2, failed: 1 }],
    documents: [],
    ...overrides,
  };
}

describe('approvalShare', () => {
  it('is the share of thumbs-up ratings', () => {
    expect(approvalShare({ up: 3, down: 1 })).toBe(0.75);
  });

  it('is null before anyone rated', () => {
    expect(approvalShare({ up: 0, down: 0 })).toBeNull();
  });
});

describe('budgetShareSpent', () => {
  it('is null when no daily budget is configured', () => {
    expect(budgetShareSpent({ spentTokens: 40, budgetTokens: 0 })).toBeNull();
  });

  it('divides spent by budget', () => {
    expect(budgetShareSpent({ spentTokens: 250, budgetTokens: 1000 })).toBe(0.25);
  });
});

describe('buildOverviewManifestFields', () => {
  it('reports the no-evidence rate', () => {
    const fields = buildOverviewManifestFields(anOverview());
    const noEvidenceField = fields.find((field) => field.label === 'No-evidence rate');
    expect(noEvidenceField?.value).toBe('22.2%');
  });

  it('shows a dash and no note when there are no answered turns to measure', () => {
    const overview = anOverview({
      latencyMilliseconds: { timeToFirstTokenP90: null, timeToFirstTokenP99: null, totalP90: null, totalP99: null },
    });
    const latencyField = buildOverviewManifestFields(overview).find((field) => field.label === 'First token p90');
    expect(latencyField?.value).toBe('—');
    expect(latencyField?.note).toBeUndefined();
  });

  it('notes failed turns only when there are some', () => {
    const turnsNote = (failed: number) =>
      buildOverviewManifestFields(anOverview({ turns: { ...anOverview().turns, failed } })).find(
        (field) => field.label === 'Turns',
      )?.note;
    expect(turnsNote(1)).toBe('1 failed');
    expect(turnsNote(0)).toBeUndefined();
  });
});

describe('enumerateCalendarDays', () => {
  it('lists every UTC day of the window inclusively', () => {
    expect(enumerateCalendarDays(anOverview().window)).toEqual(['2026-10-28', '2026-10-29', '2026-10-30']);
  });
});

describe('buildDailyTurnChartData', () => {
  it('fills days without turns with zeros and splits turns by outcome', () => {
    const { rows } = buildDailyTurnChartData(anOverview());
    expect(rows).toEqual([
      { bucketEpochMilliseconds: calendarDayToEpochMilliseconds('2026-10-28'), answered: 0, noEvidence: 0, failed: 0 },
      { bucketEpochMilliseconds: calendarDayToEpochMilliseconds('2026-10-29'), answered: 7, noEvidence: 2, failed: 1 },
      { bucketEpochMilliseconds: calendarDayToEpochMilliseconds('2026-10-30'), answered: 0, noEvidence: 0, failed: 0 },
    ]);
  });
});
