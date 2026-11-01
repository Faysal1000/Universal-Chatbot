import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { DependencyHealthCheck } from '../../health/dependency-health-check.js';
import { REDIS_CLIENT } from './redis.tokens.js';

@Injectable()
export class RedisHealthCheck implements DependencyHealthCheck {
  readonly dependencyName = 'redis';

  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  async check(): Promise<void> {
    await this.redisClient.ping();
  }
}
