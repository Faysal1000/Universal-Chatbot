import type { IncomingHttpHeaders } from 'node:http';

import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../common/errors/application-error.js';
import { generateSecureToken, sha256Hex } from '../../common/security/secure-tokens.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { HUMAN_VERIFICATION_PORT, type HumanVerificationPort } from '../../ports/human-verification.port.js';
import { WidgetAccessPolicy } from '../widget-keys/widget-access.policy.js';
import { ClientBlocksRepository } from './client-blocks.repository.js';
import { ClientIdentityHasher } from './client-identity-hasher.js';
import { PublicRateLimitsService } from './public-rate-limits.service.js';
import type { VisitorPrincipal } from './visitor-principal.js';
import { VisitorSessionsRepository } from './visitor-sessions.repository.js';

/** Sliding expiry is written at most this often, not on every request. */
const EXPIRY_EXTENSION_INTERVAL_MILLISECONDS = 60 * 60_000;

export interface VisitorSessionRequest {
  readonly turnstileToken: string | null;
  readonly fingerprint: string;
  readonly clientAddress: string;
  readonly userAgent: string | null;
  /** The website widget key the request was authorised with, if any. */
  readonly widgetKeyId: string | null;
}

export interface IssuedVisitorSession {
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly expiresAt: Date;
}

/** Issues and resolves the bearer tokens of anonymous visitors. */
@Injectable()
export class VisitorSessionsService {
  private readonly sessionTtlMilliseconds: number;

  constructor(
    private readonly visitorSessionsRepository: VisitorSessionsRepository,
    private readonly clientBlocksRepository: ClientBlocksRepository,
    private readonly clientIdentityHasher: ClientIdentityHasher,
    private readonly rateLimits: PublicRateLimitsService,
    private readonly widgetAccess: WidgetAccessPolicy,
    @Inject(HUMAN_VERIFICATION_PORT) private readonly humanVerification: HumanVerificationPort,
    @Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration,
  ) {
    this.sessionTtlMilliseconds = configuration.publicAccess.visitorSessionTtlSeconds * 1_000;
  }

  async issue(request: VisitorSessionRequest): Promise<IssuedVisitorSession> {
    const ipHash = this.clientIdentityHasher.hashAddress(request.clientAddress);
    const fingerprintHash = this.clientIdentityHasher.hashFingerprint(request.fingerprint);
    await this.assertNotBlocked(ipHash, fingerprintHash);
    await this.rateLimits.consumeSessionCreation(ipHash);
    await this.verifyHuman(request);
    const sessionToken = generateSecureToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlMilliseconds);
    const session = await this.visitorSessionsRepository.insert({
      tokenHash: sha256Hex(sessionToken),
      ipHash,
      fingerprintHash,
      userAgent: request.userAgent?.slice(0, 512) ?? null,
      widgetKeyId: request.widgetKeyId,
      expiresAt,
    });
    return { sessionId: session.id, sessionToken, expiresAt };
  }

  /**
   * The visitor behind a bearer token, or a 401 `session_expired` the client recovers from. A session started
   * by the website widget also needs its key to be active and the page's origin to be one the key lists.
   */
  async authenticate(
    sessionToken: string,
    clientAddress: string,
    headers: IncomingHttpHeaders,
  ): Promise<VisitorPrincipal> {
    const now = new Date();
    const session = await this.visitorSessionsRepository.findUnexpiredByTokenHash(
      sha256Hex(sessionToken),
      now,
    );
    if (session === undefined) throw sessionExpiredError();
    const ipHash = this.clientIdentityHasher.hashAddress(clientAddress);
    await this.assertNotBlocked(ipHash, session.fingerprintHash);
    const extensionInterval = Math.min(
      EXPIRY_EXTENSION_INTERVAL_MILLISECONDS,
      this.sessionTtlMilliseconds / 2,
    );
    if (now.getTime() - session.lastSeenAt.getTime() > extensionInterval) {
      await this.visitorSessionsRepository.extend(
        session.id,
        now,
        new Date(now.getTime() + this.sessionTtlMilliseconds),
      );
    }
    const widgetKey =
      session.widgetKeyId === null
        ? null
        : await this.widgetAccess.authorizeSession(session.widgetKeyId, headers);
    return { visitorSessionId: session.id, ipHash, fingerprintHash: session.fingerprintHash, widgetKey };
  }

  private async verifyHuman(request: VisitorSessionRequest): Promise<void> {
    if (this.humanVerification.siteKey === null) return;
    const isHuman =
      request.turnstileToken !== null &&
      (await this.humanVerification.verify(request.turnstileToken, request.clientAddress));
    if (!isHuman) {
      throw new ApplicationError(
        403,
        'human_verification_failed',
        'The verification challenge failed. Try again.',
      );
    }
  }

  private async assertNotBlocked(ipHash: string, fingerprintHash: string): Promise<void> {
    if (await this.clientBlocksRepository.isBlocked(ipHash, fingerprintHash, new Date())) {
      throw new ApplicationError(
        403,
        'client_blocked',
        'Access from this device or network has been blocked.',
      );
    }
  }
}

export function sessionExpiredError(): ApplicationError {
  return new ApplicationError(401, 'session_expired', 'The visitor session has expired. Start a new one.');
}
