import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { SERVICE_NAME, detectProcessRole } from '../../common/process-role.js';
import { RedisHealthCheck } from './redis.health-check.js';
import { REDIS_CLIENT } from './redis.tokens.js';

/**
 * Every key written through this client is prefixed with `<REDIS_KEY_PREFIX>:`. BullMQ
 * manages its own connections with the same prefix (see QueueModule).
 */
function createRedisClient(configuration: ServiceConfiguration): Redis {
  return new Redis(configuration.redis.url.reveal(), {
    keyPrefix: `${configuration.redis.keyPrefix}:`,
    connectionName: `${SERVICE_NAME}-${detectProcessRole(process.argv[1])}`,
    // Fail commands quickly while disconnected instead of queueing them indefinitely.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });
}

@Global()
@Module({
  providers: [
    { provide: REDIS_CLIENT, inject: [SERVICE_CONFIGURATION], useFactory: createRedisClient },
    RedisHealthCheck,
  ],
  exports: [REDIS_CLIENT, RedisHealthCheck],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redisClient.quit();
  }
}
