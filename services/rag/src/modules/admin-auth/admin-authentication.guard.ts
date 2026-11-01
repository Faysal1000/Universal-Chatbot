import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { ApplicationError } from '../../common/errors/application-error.js';
import { areEqualInConstantTime } from '../../common/security/secure-tokens.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { CSRF_HEADER_NAME, readSessionCookie } from './admin-cookie.js';
import type { AdminPrincipal } from './admin-principal.js';
import { AdminSessionsService, deriveCsrfToken } from './admin-sessions.service.js';

/** Lets the admin console name the user it acts for when it calls with the service key. */
const ACTOR_HEADER = 'x-admin-actor';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Admits the admin console backend (service API key as a bearer token) or a signed-in
 * admin (session cookie). Cookie-authenticated writes must also carry the CSRF header;
 * bearer requests cannot be forged cross-site, so they need none.
 */
@Injectable()
export class AdminAuthenticationGuard implements CanActivate {
  constructor(
    private readonly adminSessionsService: AdminSessionsService,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<Request>();
    request.adminPrincipal =
      this.authenticateServiceKey(request) ?? (await this.authenticateSession(request));
    return true;
  }

  private authenticateServiceKey(request: Request): AdminPrincipal | undefined {
    const authorizationHeader = request.headers.authorization;
    if (authorizationHeader === undefined) return undefined;
    const presentedKey = /^Bearer (.+)$/i.exec(authorizationHeader)?.[1]?.trim();
    const configuredKey = this.configuration.admin.apiKey?.reveal();
    if (
      presentedKey === undefined ||
      configuredKey === undefined ||
      !areEqualInConstantTime(presentedKey, configuredKey)
    ) {
      throw new ApplicationError(401, 'invalid_credentials', 'The admin API key is invalid.');
    }
    return { kind: 'service_api_key', actorUsername: readActorUsername(request) };
  }

  private async authenticateSession(request: Request): Promise<AdminPrincipal> {
    const sessionToken = readSessionCookie(request);
    const session =
      sessionToken === undefined ? undefined : await this.adminSessionsService.resolveSession(sessionToken);
    if (sessionToken === undefined || session === undefined) {
      throw new ApplicationError(401, 'authentication_required', 'Sign in to use the admin API.');
    }
    if (!SAFE_METHODS.has(request.method)) assertCsrfToken(request, sessionToken);
    return {
      kind: 'admin_user',
      adminUserId: session.adminUserId,
      username: session.username,
      sessionTokenHash: session.tokenHash,
    };
  }
}

function assertCsrfToken(request: Request, sessionToken: string): void {
  const presentedToken = request.headers[CSRF_HEADER_NAME];
  if (
    typeof presentedToken !== 'string' ||
    !areEqualInConstantTime(presentedToken, deriveCsrfToken(sessionToken))
  ) {
    throw new ApplicationError(
      403,
      'csrf_token_invalid',
      `Send the ${CSRF_HEADER_NAME} header returned at sign-in.`,
    );
  }
}

/** Printable text without control characters, as console usernames are. */
const ACTOR_USERNAME_PATTERN = /^[^\p{Cc}]{1,100}$/u;

function readActorUsername(request: Request): string | null {
  const header = request.headers[ACTOR_HEADER];
  if (header === undefined) return null;
  const username = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
  if (!ACTOR_USERNAME_PATTERN.test(username)) {
    throw new ApplicationError(422, 'validation_failed', 'The request is invalid.', {
      fieldErrors: [{ field: 'X-Admin-Actor', message: 'Send a username of 1 to 100 printable characters.' }],
    });
  }
  return username;
}
