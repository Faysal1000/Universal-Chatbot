import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.tokens.js';

export interface RateLimitRule {
  /** Logical bucket, e.g. `turns:ip:<hash>`; stored under `ratelimit:<key>`. */
  readonly key: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitDecision {
  readonly isAllowed: boolean;
  /** Whole seconds until a request would be allowed again; 0 when allowed. */
  readonly retryAfterSeconds: number;
}

/**
 * Sliding-window counter (Cloudflare's approximation): the previous fixed window's count
 * is weighted by how much of it still overlaps the sliding window. Two integers per key,
 * one atomic round trip, and no burst of 2× the limit at window boundaries.
 * KEYS[1] current window, KEYS[2] previous window; ARGV limit, window ms, elapsed ms.
 */
const CONSUME_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])
local weighted = previous * (window - elapsed) / window + current
if weighted + 1 > limit then
  return 0
end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], window * 2)
return 1
`;

/** Same weighting as CONSUME_SCRIPT, without counting a hit. */
const PEEK_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
local window = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])
local weighted = previous * (window - elapsed) / window + current
if weighted + 1 > tonumber(ARGV[1]) then
  return 0
end
return 1
`;

@Injectable()
export class SlidingWindowRateLimiter {
  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  /** Counts one hit if it fits under the limit. */
  consume(rule: RateLimitRule, nowMilliseconds: number = Date.now()): Promise<RateLimitDecision> {
    return this.evaluate(CONSUME_SCRIPT, rule, nowMilliseconds);
  }

  /** Reports whether one more hit would be allowed, without counting it. */
  peek(rule: RateLimitRule, nowMilliseconds: number = Date.now()): Promise<RateLimitDecision> {
    return this.evaluate(PEEK_SCRIPT, rule, nowMilliseconds);
  }

  private async evaluate(
    script: string,
    rule: RateLimitRule,
    nowMilliseconds: number,
  ): Promise<RateLimitDecision> {
    const windowMilliseconds = rule.windowSeconds * 1_000;
    const windowIndex = Math.floor(nowMilliseconds / windowMilliseconds);
    const elapsedMilliseconds = nowMilliseconds - windowIndex * windowMilliseconds;
    const result = await this.redisClient.eval(
      script,
      2,
      `ratelimit:${rule.key}:${windowIndex}`,
      `ratelimit:${rule.key}:${windowIndex - 1}`,
      rule.limit,
      windowMilliseconds,
      elapsedMilliseconds,
    );
    if (result === 1) return { isAllowed: true, retryAfterSeconds: 0 };
    return {
      isAllowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMilliseconds - elapsedMilliseconds) / 1_000)),
    };
  }

  /** Forgets a key, e.g. failed logins after a successful one. */
  async reset(key: string, windowSeconds: number, nowMilliseconds: number = Date.now()): Promise<void> {
    const windowIndex = Math.floor(nowMilliseconds / (windowSeconds * 1_000));
    await this.redisClient.del(`ratelimit:${key}:${windowIndex}`, `ratelimit:${key}:${windowIndex - 1}`);
  }
}
