/**
 * One-shot migration runner (`npm run db:migrate`), executed as its own container
 * before the api and worker start. Migrations never run implicitly at application
 * startup, so two replicas can never race to migrate.
 */
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { errorMessageOf } from '../common/errors/error-message.js';
import { loadConfiguration } from '../config/configuration.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

async function runMigrations(): Promise<void> {
  const configuration = loadConfiguration();
  const pool = new pg.Pool({ connectionString: configuration.database.url.reveal(), max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: 'public',
      migrationsTable: 'schema_migrations',
    });
    process.stdout.write(`${JSON.stringify({ level: 'info', message: 'Database migrations applied' })}\n`);
  } finally {
    await pool.end();
  }
}

runMigrations().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', message: 'Database migration failed', error: errorMessageOf(error) })}\n`,
  );
  process.exit(1);
});
