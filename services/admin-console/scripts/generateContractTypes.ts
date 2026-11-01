/**
 * Regenerates the TypeScript types of each service's admin API from the OpenAPI snapshots in
 * `contracts/`. Refresh a snapshot first, then run `npm run contracts:generate`.
 */
import { execFileSync } from 'node:child_process';

const OPENAPI_TYPESCRIPT = 'openapi-typescript@7.13.0';
const SERVICE_CONTRACTS = ['local-llm', 'rag'] as const;

for (const service of SERVICE_CONTRACTS) {
  execFileSync(
    'npx',
    ['--yes', OPENAPI_TYPESCRIPT, `contracts/${service}.openapi.json`, '--output', `src/contracts/${service}.ts`],
    { stdio: 'inherit' },
  );
}
