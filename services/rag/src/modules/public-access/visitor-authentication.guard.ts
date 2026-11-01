import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { resolveClientAddress } from '../../common/http/client-address.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { PublicRateLimitsService } from './public-rate-limits.service.js';
import { sessionExpiredError, VisitorSessionsService } from './visitor-sessions.service.js';

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]{20,200})$/;

/** Requires `Authorization: Bearer <sessionToken>` and applies the per-IP request limit. */
@Injectable()
export class VisitorAuthenticationGuard implements CanActivate {
  constructor(
    private readonly visitorSessions: VisitorSessionsService,
    private readonly rateLimits: PublicRateLimitsService,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<Request>();
    const sessionToken = BEARER_PATTERN.exec(request.headers.authorization ?? '')?.[1];
    if (sessionToken === undefined) throw sessionExpiredError();
    const clientAddress = resolveClientAddress(request, this.configuration.publicAccess.trustedProxyHops);
    const visitor = await this.visitorSessions.authenticate(sessionToken, clientAddress, request.headers);
    await this.rateLimits.consumeRequest(visitor.ipHash);
    request.visitorPrincipal = visitor;
    return true;
  }
}
