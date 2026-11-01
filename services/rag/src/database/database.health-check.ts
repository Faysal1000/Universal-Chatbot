import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';

import type { DependencyHealthCheck } from '../health/dependency-health-check.js';
import { DATABASE_POOL } from './database.tokens.js';

@Injectable()
export class DatabaseHealthCheck implements DependencyHealthCheck {
  readonly dependencyName = 'postgres';

  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  async check(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}
