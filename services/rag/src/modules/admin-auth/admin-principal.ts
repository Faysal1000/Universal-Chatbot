import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Who is calling the admin API: a signed-in admin (cookie session) or the admin console
 * backend using the service API key, which has no user of its own.
 */
export type AdminPrincipal =
  | {
      readonly kind: 'admin_user';
      readonly adminUserId: string;
      readonly username: string;
      readonly sessionTokenHash: string;
    }
  | {
      readonly kind: 'service_api_key';
      /** The console user the key acts for (`X-Admin-Actor`), when the caller says. */
      readonly actorUsername: string | null;
    };

/** Who an audit record names: an admin user, a console user acting through the key, or nobody. */
export interface AuditActor {
  readonly adminUserId: string | null;
  readonly username: string | null;
}

export const UNKNOWN_AUDIT_ACTOR: AuditActor = { adminUserId: null, username: null };

/** The acting admin user's id; null for the service key. */
export function actingAdminUserId(principal: AdminPrincipal): string | null {
  return principal.kind === 'admin_user' ? principal.adminUserId : null;
}

export function auditActorOf(principal: AdminPrincipal): AuditActor {
  return principal.kind === 'admin_user'
    ? { adminUserId: principal.adminUserId, username: principal.username }
    : { adminUserId: null, username: principal.actorUsername };
}

export const CurrentAdmin = createParamDecorator((_data: unknown, executionContext: ExecutionContext) => {
  const principal = executionContext.switchToHttp().getRequest<Request>().adminPrincipal;
  if (principal === undefined) {
    throw new Error('CurrentAdmin used on a route without AdminAuthenticationGuard');
  }
  return principal;
});
