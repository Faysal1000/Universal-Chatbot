import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { ApplicationError } from '../../common/errors/application-error.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.tokens.js';

const DAY_IN_SECONDS = 24 * 60 * 60;

/**
 * Caps the tokens all visitors together may spend per UTC day, protecting the model bill
 * from abuse that slips past per-client limits. Spending is recorded after each turn.
 */
@Injectable()
export class DailyTokenBudgetService {
  private readonly dailyTokenBudget: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    @Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration,
  ) {
    this.dailyTokenBudget = configuration.publicAccess.dailyTokenBudget;
  }

  async assertBudgetLeft(now: Date = new Date()): Promise<void> {
    if (this.dailyTokenBudget === 0) return;
    if ((await this.readSpentTokens(now)) >= this.dailyTokenBudget) {
      throw new ApplicationError(
        503,
        'service_unavailable',
        'The assistant has reached its daily limit. Please come back tomorrow.',
        { retryAfterSeconds: secondsUntilNextUtcDay(now) },
      );
    }
  }

  async recordSpending(tokenCount: number, now: Date = new Date()): Promise<void> {
    if (tokenCount <= 0) return;
    const key = budgetKey(now);
    await this.redisClient
      .multi()
      .incrby(key, tokenCount)
      .expire(key, 2 * DAY_IN_SECONDS)
      .exec();
  }

  async readSpending(now: Date = new Date()): Promise<{ spentTokens: number; budgetTokens: number }> {
    return { spentTokens: await this.readSpentTokens(now), budgetTokens: this.dailyTokenBudget };
  }

  private async readSpentTokens(now: Date): Promise<number> {
    return Number((await this.redisClient.get(budgetKey(now))) ?? '0');
  }
}

function budgetKey(now: Date): string {
  return `token-budget:${now.toISOString().slice(0, 10)}`;
}

function secondsUntilNextUtcDay(now: Date): number {
  const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextDay - now.getTime()) / 1_000));
}
