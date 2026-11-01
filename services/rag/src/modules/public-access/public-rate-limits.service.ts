import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../common/errors/application-error.js';
import {
  type RateLimitRule,
  SlidingWindowRateLimiter,
} from '../../common/rate-limiting/sliding-window-rate-limiter.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import type { WidgetGrant } from '../widget-keys/widget-access.policy.js';
import type { VisitorPrincipal } from './visitor-principal.js';

const MINUTE_IN_SECONDS = 60;
const HOUR_IN_SECONDS = 60 * 60;

/** Layered limits on the public API, counted in Redis so every api replica shares them. */
@Injectable()
export class PublicRateLimitsService {
  private readonly limits: ServiceConfiguration['publicAccess']['rateLimits'];

  constructor(
    private readonly rateLimiter: SlidingWindowRateLimiter,
    @Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration,
  ) {
    this.limits = configuration.publicAccess.rateLimits;
  }

  /** Any authenticated public request (cheap reads included). */
  async consumeRequest(ipHash: string): Promise<void> {
    await this.consumeAll([
      {
        key: `requests:ip:${ipHash}`,
        limit: this.limits.requestsPerMinutePerIp,
        windowSeconds: MINUTE_IN_SECONDS,
      },
    ]);
  }

  async consumeSessionCreation(ipHash: string): Promise<void> {
    await this.consumeAll([
      {
        key: `sessions:ip:${ipHash}`,
        limit: this.limits.sessionsPerHourPerIp,
        windowSeconds: HOUR_IN_SECONDS,
      },
    ]);
  }

  /** One submitted turn (however many messages it batches). */
  async consumeTurn(visitor: VisitorPrincipal): Promise<void> {
    await this.consumeAll([
      {
        key: `turns:session:${visitor.visitorSessionId}`,
        limit: this.limits.turnsPerMinutePerSession,
        windowSeconds: MINUTE_IN_SECONDS,
      },
      {
        key: `turns:fingerprint:${visitor.fingerprintHash}`,
        limit: this.limits.turnsPerMinutePerFingerprint,
        windowSeconds: MINUTE_IN_SECONDS,
      },
      {
        key: `turns:ip:${visitor.ipHash}`,
        limit: this.limits.turnsPerMinutePerIp,
        windowSeconds: MINUTE_IN_SECONDS,
      },
      ...(visitor.widgetKey === null ? [] : [widgetKeyTurnRule(visitor.widgetKey)]),
    ]);
  }

  /** Checks every rule; a rejection by a later rule still counts the earlier ones (cheap, and safer). */
  private async consumeAll(rules: readonly RateLimitRule[]): Promise<void> {
    for (const rule of rules) {
      const decision = await this.rateLimiter.consume(rule);
      if (!decision.isAllowed) {
        throw new ApplicationError(429, 'rate_limited', 'Too many requests. Please wait a moment.', {
          retryAfterSeconds: Math.max(1, decision.retryAfterSeconds),
        });
      }
    }
  }
}

/** Every visitor of one website together: what the admin set on its widget key. */
function widgetKeyTurnRule(widgetKey: WidgetGrant): RateLimitRule {
  return {
    key: `turns:widget-key:${widgetKey.widgetKeyId}`,
    limit: widgetKey.turnsPerMinute,
    windowSeconds: MINUTE_IN_SECONDS,
  };
}
