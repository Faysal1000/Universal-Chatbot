import { describe, expect, it } from 'vitest';

import { validTestEnvironment } from '../../test/support/test-environment.js';
import { parseConfiguration } from '../config/configuration.js';
import type { DependencyHealthCheck } from './dependency-health-check.js';
import { HealthService } from './health.service.js';

const configuration = parseConfiguration(
  validTestEnvironment({ RAG_DEPENDENCY_CHECK_TIMEOUT_MILLISECONDS: '100' }),
);

const healthyDependency = (dependencyName: string): DependencyHealthCheck => ({
  dependencyName,
  check: () => Promise.resolve(),
});
const failingDependency = (dependencyName: string): DependencyHealthCheck => ({
  dependencyName,
  check: () => Promise.reject(new Error('connection refused')),
});
const hangingDependency = (dependencyName: string): DependencyHealthCheck => ({
  dependencyName,
  check: () => new Promise<void>(() => undefined),
});

describe('HealthService.checkReadiness', () => {
  it('is ready when every dependency is up', async () => {
    const healthService = new HealthService(
      [healthyDependency('postgres'), healthyDependency('redis')],
      configuration,
    );

    await expect(healthService.checkReadiness()).resolves.toEqual({
      status: 'ready',
      checks: { postgres: 'up', redis: 'up' },
    });
  });

  it('is not ready when a dependency fails, and reports which one', async () => {
    const healthService = new HealthService(
      [healthyDependency('postgres'), failingDependency('redis')],
      configuration,
    );

    await expect(healthService.checkReadiness()).resolves.toEqual({
      status: 'not_ready',
      checks: { postgres: 'up', redis: 'down' },
    });
  });

  it('treats a dependency that does not answer within the timeout as down', async () => {
    const healthService = new HealthService([hangingDependency('object_storage')], configuration);
    const startedAt = performance.now();

    const readinessReport = await healthService.checkReadiness();

    expect(readinessReport.checks.object_storage).toBe('down');
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it('reports shutting_down once shutdown has begun, even if dependencies are up', async () => {
    const healthService = new HealthService([healthyDependency('postgres')], configuration);
    healthService.beforeApplicationShutdown();

    await expect(healthService.checkReadiness()).resolves.toMatchObject({ status: 'shutting_down' });
  });
});
