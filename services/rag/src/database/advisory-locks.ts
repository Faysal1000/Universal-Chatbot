import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';

import { DATABASE_POOL } from './database.tokens.js';

/** Application-wide lock identifiers (Postgres advisory lock keys). */
export const ADVISORY_LOCK_KEYS = {
  indexVersionCreation: 7_301_001,
} as const;

/**
 * Serialises work across the api and worker processes with a Postgres session-level
 * advisory lock held on one pooled connection for the duration of `work`.
 */
@Injectable()
export class AdvisoryLocks {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  async runExclusively<Result>(lockKey: number, work: () => Promise<Result>): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
      try {
        return await work();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      }
    } finally {
      client.release();
    }
  }
}
