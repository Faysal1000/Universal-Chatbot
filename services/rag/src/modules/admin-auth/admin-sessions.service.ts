import { Inject, Injectable } from '@nestjs/common';

import { generateSecureToken, hmacSha256Hex, sha256Hex } from '../../common/security/secure-tokens.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { AdminAccountsRepository, type ActiveAdminSession } from './admin-accounts.repository.js';

/** Last-seen updates are throttled so every admin request is not also a write. */
const LAST_SEEN_UPDATE_INTERVAL_MILLISECONDS = 60_000;

export interface IssuedAdminSession {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
}

/**
 * Server-side admin sessions: the cookie holds a random token, the database only its
 * SHA-256. The CSRF token is an HMAC of the session token, so it needs no storage and
 * is useless without the cookie.
 */
@Injectable()
export class AdminSessionsService {
  private readonly lastSeenUpdates = new Map<string, number>();

  constructor(
    private readonly adminAccountsRepository: AdminAccountsRepository,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async issueSession(
    adminUserId: string,
    clientMetadata: { ipHash: string; userAgent: string | null },
  ): Promise<IssuedAdminSession> {
    const sessionToken = generateSecureToken();
    const expiresAt = new Date(Date.now() + this.configuration.admin.sessionTtlSeconds * 1_000);
    await this.adminAccountsRepository.insertSession({
      tokenHash: sha256Hex(sessionToken),
      adminUserId,
      ipHash: clientMetadata.ipHash,
      userAgent: clientMetadata.userAgent,
      expiresAt,
    });
    return { sessionToken, csrfToken: deriveCsrfToken(sessionToken), expiresAt };
  }

  async resolveSession(
    sessionToken: string,
  ): Promise<(ActiveAdminSession & { tokenHash: string }) | undefined> {
    const tokenHash = sha256Hex(sessionToken);
    const session = await this.adminAccountsRepository.findActiveSession(tokenHash, new Date());
    if (session === undefined) return undefined;
    await this.recordActivity(tokenHash);
    return { ...session, tokenHash };
  }

  async revokeSession(tokenHash: string): Promise<void> {
    this.lastSeenUpdates.delete(tokenHash);
    await this.adminAccountsRepository.deleteSession(tokenHash);
  }

  private async recordActivity(tokenHash: string): Promise<void> {
    const now = Date.now();
    const lastUpdate = this.lastSeenUpdates.get(tokenHash) ?? 0;
    if (now - lastUpdate < LAST_SEEN_UPDATE_INTERVAL_MILLISECONDS) return;
    this.lastSeenUpdates.set(tokenHash, now);
    await this.adminAccountsRepository.touchSession(tokenHash);
  }
}

export function deriveCsrfToken(sessionToken: string): string {
  return hmacSha256Hex(sessionToken, 'rag-admin-csrf');
}
