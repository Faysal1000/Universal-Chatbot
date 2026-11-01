import type { DynamicModule, Type } from '@nestjs/common';

import { LoggingModule } from '../common/logging/logging.module.js';
import type { ServiceConfiguration } from '../config/configuration.js';
import { ConfigurationModule } from '../config/configuration.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { HealthModule } from '../health/health.module.js';
import { EmbeddingServerModule } from '../infrastructure/embedding-server/embedding-server.module.js';
import { LlmGatewayModule } from '../infrastructure/llm-gateway/llm-gateway.module.js';
import { AuditModule } from '../modules/audit/audit.module.js';
import { RateLimitingModule } from '../common/rate-limiting/rate-limiting.module.js';
import { TokenEstimationModule } from '../common/text/token-estimation.module.js';
import { ObjectStorageModule } from '../infrastructure/object-storage/object-storage.module.js';
import { RedisModule } from '../infrastructure/redis/redis.module.js';
import { QueueModule } from '../queue/queue.module.js';

/** Modules shared by the api and worker processes: config, logging, datastores, outbound services, health. */
export function coreModules(configuration: ServiceConfiguration): (Type | DynamicModule)[] {
  return [
    ConfigurationModule.forConfiguration(configuration),
    LoggingModule,
    DatabaseModule,
    RedisModule,
    ObjectStorageModule,
    QueueModule,
    EmbeddingServerModule,
    LlmGatewayModule,
    AuditModule,
    RateLimitingModule,
    TokenEstimationModule,
    HealthModule,
  ];
}
