import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { WidgetGrant } from '../widget-keys/widget-access.policy.js';

/** An authenticated anonymous visitor. IP and fingerprint are only known as HMACs. */
export interface VisitorPrincipal {
  readonly visitorSessionId: string;
  readonly ipHash: string;
  readonly fingerprintHash: string;
  /** The website widget key the session was started with; null for the first-party chat app. */
  readonly widgetKey: WidgetGrant | null;
}

export const CurrentVisitor = createParamDecorator((_data: unknown, executionContext: ExecutionContext) => {
  const principal = executionContext.switchToHttp().getRequest<Request>().visitorPrincipal;
  if (principal === undefined) {
    throw new Error('CurrentVisitor used on a route without VisitorAuthenticationGuard');
  }
  return principal;
});
