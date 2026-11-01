import { Module } from '@nestjs/common';

import { DatabaseHealthCheck } from '../database/database.health-check.js';
import { ObjectStorageHealthCheck } from '../infrastructure/object-storage/object-storage.health-check.js';
import { RedisHealthCheck } from '../infrastructure/redis/redis.health-check.js';
import type { DependencyHealthCheck } from './dependency-health-check.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { DEPENDENCY_HEALTH_CHECKS } from './health.tokens.js';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: DEPENDENCY_HEALTH_CHECKS,
      inject: [DatabaseHealthCheck, RedisHealthCheck, ObjectStorageHealthCheck],
      useFactory: (...dependencyHealthChecks: DependencyHealthCheck[]): DependencyHealthCheck[] =>
        dependencyHealthChecks,
    },
  ],
})
export class HealthModule {}
