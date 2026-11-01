import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../common/errors/application-error.js';
import { SlidingWindowRateLimiter } from '../../common/rate-limiting/sliding-window-rate-limiter.js';
import { verifyPassword } from '../../common/security/password-hashing.js';
import { hmacSha256Hex } from '../../common/security/secure-tokens.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { AuditEventsRepository } from '../audit/audit-events.repository.js';
import { AdminAccountsRepository } from './admin-accounts.repository.js';
import { AdminSessionsService, type IssuedAdminSession } from './admin-sessions.service.js';
import { UNKNOWN_AUDIT_ACTOR } from './admin-principal.js';

const MAXIMUM_FAILED_LOGINS = 5;
const FAILED_LOGIN_WINDOW_SECONDS = 15 * 60;
/**
 * A real hash verified when the username is unknown, so a miss costs the same time as a
 * wrong password and does not reveal which usernames exist.
 */
const TIMING_EQUALISATION_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$7Qd9mVBx8Hvbs8gDiKV6QUP9N6QQKp4wQ5n0bA8K0vM=';

export interface LoginAttempt {
  readonly username: string;
  readonly password: string;
  readonly clientAddress: string;
  readonly userAgent: string | null;
  readonly requestId: string | undefined;
}

export interface SuccessfulLogin extends IssuedAdminSession {
  readonly adminUserId: string;
  readonly username: string;
}

@Injectable()
export class AdminLoginService {
  constructor(
    private readonly adminAccountsRepository: AdminAccountsRepository,
    private readonly adminSessionsService: AdminSessionsService,
    private readonly rateLimiter: SlidingWindowRateLimiter,
    private readonly auditEventsRepository: AuditEventsRepository,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async logIn(attempt: LoginAttempt): Promise<SuccessfulLogin> {
    const ipHash = this.hashClientValue(attempt.clientAddress);
    const throttleKey = `admin-login:${ipHash}:${attempt.username.toLowerCase()}`;
    await this.consumeLoginAttempt(throttleKey);
    const account = await this.adminAccountsRepository.findByUsername(attempt.username);
    const isPasswordValid = await verifyPassword(
      attempt.password,
      account?.passwordHash ?? TIMING_EQUALISATION_HASH,
    );
    if (account === undefined || !account.isActive || !isPasswordValid) {
      await this.recordFailedLogin(attempt);
      throw new ApplicationError(401, 'invalid_credentials', 'The username or password is incorrect.');
    }
    await this.rateLimiter.reset(throttleKey, FAILED_LOGIN_WINDOW_SECONDS);
    await this.adminAccountsRepository.recordLogin(account.id);
    const session = await this.adminSessionsService.issueSession(account.id, {
      ipHash,
      userAgent: attempt.userAgent,
    });
    await this.auditEventsRepository.record({
      actor: { adminUserId: account.id, username: account.username },
      action: 'admin.logged_in',
      targetType: 'admin_user',
      targetId: account.id,
      ...(attempt.requestId === undefined ? {} : { requestId: attempt.requestId }),
    });
    return { ...session, adminUserId: account.id, username: account.username };
  }

  /** Counted before the password check, so parallel guesses cannot all slip past the limit; success resets it. */
  private async consumeLoginAttempt(throttleKey: string): Promise<void> {
    const decision = await this.rateLimiter.consume(this.failedLoginRule(throttleKey));
    if (!decision.isAllowed) {
      throw new ApplicationError(429, 'rate_limited', 'Too many failed sign-in attempts. Try again later.', {
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
  }

  private async recordFailedLogin(attempt: LoginAttempt): Promise<void> {
    await this.auditEventsRepository.record({
      actor: UNKNOWN_AUDIT_ACTOR,
      action: 'admin.login_failed',
      targetType: 'admin_user',
      targetId: attempt.username.slice(0, 128),
      ...(attempt.requestId === undefined ? {} : { requestId: attempt.requestId }),
    });
  }

  private failedLoginRule(throttleKey: string) {
    return { key: throttleKey, limit: MAXIMUM_FAILED_LOGINS, windowSeconds: FAILED_LOGIN_WINDOW_SECONDS };
  }

  private hashClientValue(value: string): string {
    return hmacSha256Hex(this.configuration.publicAccess.clientHashSecret.reveal(), value);
  }
}
