import { type BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';

import type { ServiceConfiguration } from '../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../config/configuration.module.js';
import type { DependencyHealthCheck } from './dependency-health-check.js';
import { DEPENDENCY_HEALTH_CHECKS } from './health.tokens.js';

export type DependencyStatus = 'up' | 'down';

export interface ReadinessReport {
  readonly status: 'ready' | 'not_ready' | 'shutting_down';
  readonly checks: Readonly<Record<string, DependencyStatus>>;
}

class DependencyCheckTimeoutError extends Error {
  constructor(dependencyName: string, timeoutMilliseconds: number) {
    super(`${dependencyName} did not respond within ${timeoutMilliseconds} ms`);
  }
}

@Injectable()
export class HealthService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(HealthService.name);
  private isShuttingDown = false;

  constructor(
    @Inject(DEPENDENCY_HEALTH_CHECKS)
    private readonly dependencyHealthChecks: readonly DependencyHealthCheck[],
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  /** Fail readiness first so load balancers stop routing before connections close. */
  beforeApplicationShutdown(): void {
    this.isShuttingDown = true;
  }

  /**
   * Checks every dependency in parallel, each bounded by a timeout. Failure reasons
   * are logged, never returned: the endpoint is unauthenticated.
   */
  async checkReadiness(): Promise<ReadinessReport> {
    const checkResults = await Promise.all(
      this.dependencyHealthChecks.map(async (dependencyHealthCheck) => ({
        dependencyName: dependencyHealthCheck.dependencyName,
        status: await this.runCheck(dependencyHealthCheck),
      })),
    );
    const checks = Object.fromEntries(
      checkResults.map(({ dependencyName, status }) => [dependencyName, status]),
    );
    if (this.isShuttingDown) {
      return { status: 'shutting_down', checks };
    }
    const allDependenciesUp = checkResults.every(({ status }) => status === 'up');
    return { status: allDependenciesUp ? 'ready' : 'not_ready', checks };
  }

  private async runCheck(dependencyHealthCheck: DependencyHealthCheck): Promise<DependencyStatus> {
    const timeoutMilliseconds = this.configuration.dependencyCheckTimeoutMilliseconds;
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new DependencyCheckTimeoutError(dependencyHealthCheck.dependencyName, timeoutMilliseconds));
      }, timeoutMilliseconds);
    });
    try {
      await Promise.race([dependencyHealthCheck.check(), timeout]);
      return 'up';
    } catch (error: unknown) {
      this.logger.warn(
        { dependency: dependencyHealthCheck.dependencyName, err: error },
        'Dependency health check failed',
      );
      return 'down';
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
