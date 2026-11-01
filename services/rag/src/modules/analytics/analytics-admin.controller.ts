import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ApiJsonResponse, ApiQueryParameters } from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AdminAuthenticationGuard } from '../admin-auth/admin-authentication.guard.js';
import { DailyTokenBudgetService } from '../public-access/daily-token-budget.service.js';
import { AnalyticsRepository } from './analytics.repository.js';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const overviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7).describe('Window ending now'),
});

const nullableMilliseconds = z.number().int().nullable();

const analyticsOverviewSchema = z.object({
  window: z.object({ from: z.iso.datetime(), to: z.iso.datetime(), days: z.number().int() }),
  turns: z.object({
    total: z.number().int().describe('Turns the visitor saw an outcome for'),
    answered: z.number().int(),
    noEvidence: z.number().int(),
    cancelled: z.number().int(),
    failed: z.number().int(),
    noEvidenceRate: z.number().nullable().describe('noEvidence / (answered + noEvidence)'),
  }),
  latencyMilliseconds: z.object({
    timeToFirstTokenP90: nullableMilliseconds,
    timeToFirstTokenP99: nullableMilliseconds,
    totalP90: nullableMilliseconds,
    totalP99: nullableMilliseconds,
  }),
  tokens: z.object({ input: z.number().int(), output: z.number().int() }),
  todayBudget: z.object({ spentTokens: z.number().int(), budgetTokens: z.number().int() }),
  feedback: z.object({ up: z.number().int(), down: z.number().int() }),
  newConversations: z.number().int(),
  newVisitorSessions: z.number().int(),
  daily: z.array(
    z.object({
      date: z.string(),
      turns: z.number().int(),
      noEvidence: z.number().int(),
      failed: z.number().int(),
    }),
  ),
  documents: z.array(z.object({ status: z.string(), total: z.number().int(), enabled: z.number().int() })),
});
type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

@ApiTags('Admin: analytics')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin/analytics')
@UseGuards(AdminAuthenticationGuard)
export class AnalyticsAdminController {
  constructor(
    private readonly analyticsRepository: AnalyticsRepository,
    private readonly dailyTokenBudget: DailyTokenBudgetService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Questions, outcomes, latency, feedback and documents over a window' })
  @ApiQueryParameters(overviewQuerySchema)
  @ApiJsonResponse(analyticsOverviewSchema)
  async overview(
    @Query(new ZodValidationPipe(overviewQuerySchema)) query: z.infer<typeof overviewQuerySchema>,
  ): Promise<AnalyticsOverview> {
    const now = new Date();
    const since = new Date(now.getTime() - query.days * DAY_IN_MILLISECONDS);
    const [totals, latency, daily, feedback, newConversations, newVisitorSessions, documents, todayBudget] =
      await Promise.all([
        this.analyticsRepository.turnTotals(since),
        this.analyticsRepository.answerLatency(since),
        this.analyticsRepository.dailyTurnCounts(since),
        this.analyticsRepository.feedbackCounts(since),
        this.analyticsRepository.newConversationCount(since),
        this.analyticsRepository.newVisitorSessionCount(since),
        this.analyticsRepository.documentCountsByStatus(),
        this.dailyTokenBudget.readSpending(now),
      ]);
    const decidedTurns = totals.answered + totals.noEvidence;
    return {
      window: { from: since.toISOString(), to: now.toISOString(), days: query.days },
      turns: {
        total: totals.turns,
        answered: totals.answered,
        noEvidence: totals.noEvidence,
        cancelled: totals.cancelled,
        failed: totals.failed,
        noEvidenceRate: decidedTurns === 0 ? null : totals.noEvidence / decidedTurns,
      },
      latencyMilliseconds: latency,
      tokens: { input: totals.inputTokens, output: totals.outputTokens },
      todayBudget,
      feedback,
      newConversations,
      newVisitorSessions,
      daily,
      documents,
    };
  }
}
