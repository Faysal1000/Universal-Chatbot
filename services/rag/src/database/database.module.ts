import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import type { ServiceConfiguration } from '../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../config/configuration.module.js';
import { SERVICE_NAME, detectProcessRole } from '../common/process-role.js';
import { AdvisoryLocks } from './advisory-locks.js';
import { DatabaseHealthCheck } from './database.health-check.js';
import { DATABASE, DATABASE_POOL, type Database } from './database.tokens.js';
import * as schema from './schema.js';

function createDatabasePool(configuration: ServiceConfiguration): pg.Pool {
  return new pg.Pool({
    connectionString: configuration.database.url.reveal(),
    max: configuration.database.poolSize,
    statement_timeout: configuration.database.statementTimeoutMilliseconds,
    application_name: `${SERVICE_NAME}-${detectProcessRole(process.argv[1])}`,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}

@Global()
@Module({
  providers: [
    { provide: DATABASE_POOL, inject: [SERVICE_CONFIGURATION], useFactory: createDatabasePool },
    {
      provide: DATABASE,
      inject: [DATABASE_POOL],
      useFactory: (pool: pg.Pool): Database => drizzle({ client: pool, schema }),
    },
    DatabaseHealthCheck,
    AdvisoryLocks,
  ],
  exports: [DATABASE, DATABASE_POOL, DatabaseHealthCheck, AdvisoryLocks],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
