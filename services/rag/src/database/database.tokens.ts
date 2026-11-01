import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

/** Injection token for the raw connection pool (health checks, shutdown). */
export const DATABASE_POOL = Symbol('DATABASE_POOL');
/** Injection token for the typed Drizzle client. */
export const DATABASE = Symbol('DATABASE');
