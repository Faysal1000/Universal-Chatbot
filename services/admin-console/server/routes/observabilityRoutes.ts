/** Platform health computed by the BFF. */
import type { FastifyInstance } from 'fastify';

import type { PlatformHealth } from '../health/platformHealth.ts';
import type { buildAdminGuard } from '../security/adminAuthentication.ts';

export interface ObservabilityRouteOptions {
  readonly requireAdmin: ReturnType<typeof buildAdminGuard>;
  readonly platformHealth: PlatformHealth;
}

export function registerObservabilityRoutes(app: FastifyInstance, options: ObservabilityRouteOptions): void {
  const { requireAdmin, platformHealth } = options;

  app.get('/api/platform/health', { onRequest: requireAdmin }, async () => ({
    services: await platformHealth.check(),
  }));
}
