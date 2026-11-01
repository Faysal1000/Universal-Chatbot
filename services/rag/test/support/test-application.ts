import type { DynamicModule } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { configureHttpApplication } from '../../src/app/http-application.js';
import type { ProcessRole } from '../../src/common/process-role.js';
import { parseConfiguration, type ServiceConfiguration } from '../../src/config/configuration.js';
import type { DependencyHealthCheck } from '../../src/health/dependency-health-check.js';
import { DEPENDENCY_HEALTH_CHECKS } from '../../src/health/health.tokens.js';
import { REDIS_CLIENT } from '../../src/infrastructure/redis/redis.tokens.js';
import { ParseProgressListener } from '../../src/modules/ingestion/parse-progress-listener.service.js';
import { MaintenanceSchedulerService } from '../../src/modules/maintenance/maintenance-scheduler.service.js';
import { QueueWorkerHostService } from '../../src/queue/queue-worker-host.service.js';
import { validTestEnvironment } from './test-environment.js';

/** Health check whose outcome a test controls. */
export class ControllableHealthCheck implements DependencyHealthCheck {
  isHealthy = true;

  constructor(readonly dependencyName: string) {}

  check(): Promise<void> {
    return this.isHealthy ? Promise.resolve() : Promise.reject(new Error(`${this.dependencyName} is down`));
  }
}

export interface TestApplication {
  readonly application: NestExpressApplication;
  readonly configuration: ServiceConfiguration;
  readonly healthChecks: readonly ControllableHealthCheck[];
}

/**
 * Boots a real root module with the production HTTP setup. Only network-bound pieces
 * are replaced: health checks are controllable, Redis is a no-op client (ioredis
 * would otherwise start connecting on construction) and the queue consumers do not start.
 */
export async function createTestApplication(
  processRole: ProcessRole,
  buildRootModule: (configuration: ServiceConfiguration) => DynamicModule,
  environmentOverrides: Record<string, string | undefined> = {},
): Promise<TestApplication> {
  const configuration = parseConfiguration(validTestEnvironment(environmentOverrides));
  const healthChecks = ['postgres', 'redis', 'object_storage'].map(
    (dependencyName) => new ControllableHealthCheck(dependencyName),
  );
  const testingModule = await Test.createTestingModule({ imports: [buildRootModule(configuration)] })
    .overrideProvider(DEPENDENCY_HEALTH_CHECKS)
    .useValue(healthChecks)
    .overrideProvider(REDIS_CLIENT)
    .useValue({ ping: () => Promise.resolve('PONG'), quit: () => Promise.resolve('OK') })
    .overrideProvider(QueueWorkerHostService)
    .useValue({})
    .overrideProvider(ParseProgressListener)
    .useValue({})
    .overrideProvider(MaintenanceSchedulerService)
    .useValue({})
    .compile();

  const application = testingModule.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureHttpApplication(application, configuration, processRole);
  await application.init();
  return { application, configuration, healthChecks };
}
