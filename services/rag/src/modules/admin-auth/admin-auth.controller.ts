import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiCookieAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { resolveClientAddress } from '../../common/http/client-address.js';
import { requestIdOf } from '../../common/http/request-identity.js';
import { ApiJsonBody } from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { AdminAuthenticationGuard } from './admin-authentication.guard.js';
import { clearSessionCookie, writeSessionCookie } from './admin-cookie.js';
import { AdminLoginService } from './admin-login.service.js';
import { type AdminPrincipal, CurrentAdmin } from './admin-principal.js';
import { AdminSessionsService } from './admin-sessions.service.js';

const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(1024),
});

export interface AdminSignInResponse {
  readonly admin: { readonly id: string; readonly username: string };
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export interface CurrentAdminResponse {
  readonly kind: AdminPrincipal['kind'];
  readonly admin: { readonly id: string; readonly username: string } | null;
}

@ApiTags('Admin: authentication')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminLoginService: AdminLoginService,
    private readonly adminSessionsService: AdminSessionsService,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Sets the HttpOnly session cookie and returns the CSRF token to send as `X-CSRF-Token` on every write. ' +
      'Five failed attempts per 15 minutes per address and username return 429.',
  })
  @ApiJsonBody(loginRequestSchema)
  async logIn(
    @Body(new ZodValidationPipe(loginRequestSchema)) credentials: z.infer<typeof loginRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminSignInResponse> {
    const login = await this.adminLoginService.logIn({
      ...credentials,
      clientAddress: resolveClientAddress(request, this.configuration.publicAccess.trustedProxyHops),
      userAgent: request.headers['user-agent'] ?? null,
      requestId: requestIdOf(request),
    });
    writeSessionCookie(response, login.sessionToken, login.expiresAt, this.configuration.admin.cookieSecure);
    return {
      admin: { id: login.adminUserId, username: login.username },
      csrfToken: login.csrfToken,
      expiresAt: login.expiresAt.toISOString(),
    };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AdminAuthenticationGuard)
  @ApiOperation({ summary: 'Sign out and revoke the session' })
  async logOut(
    @CurrentAdmin() principal: AdminPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (principal.kind === 'admin_user') {
      await this.adminSessionsService.revokeSession(principal.sessionTokenHash);
    }
    clearSessionCookie(response, this.configuration.admin.cookieSecure);
  }

  @Get('me')
  @UseGuards(AdminAuthenticationGuard)
  @ApiOperation({ summary: 'The signed-in admin, or the service principal for API-key callers' })
  describeCurrentAdmin(@CurrentAdmin() principal: AdminPrincipal): CurrentAdminResponse {
    return principal.kind === 'admin_user'
      ? { kind: principal.kind, admin: { id: principal.adminUserId, username: principal.username } }
      : { kind: principal.kind, admin: null };
  }
}
