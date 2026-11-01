import { defineConfig } from 'drizzle-kit';

// Used only by `npm run db:generate` to diff src/database/schema.ts into SQL migrations.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  migrations: { table: 'schema_migrations', schema: 'public' },
});
