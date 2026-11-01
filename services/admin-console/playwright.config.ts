import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real admin console image against the real platform: the root
 * docker-compose stack (rag, llm-gateway, local-llm, embedding-server, admin-console).
 * Nothing is mocked.
 *
 * Credentials come from `.env.e2e` (gitignored): ADMIN_CONSOLE_E2E_USERNAME / _PASSWORD, the
 * plain password behind ADMIN_CONSOLE_ADMIN_PASSWORD_HASH in the root platform.env.
 */
if (existsSync('.env.e2e')) process.loadEnvFile('.env.e2e');

export default defineConfig({
  testDir: './e2e',
  // One worker: the tests change shared platform state (routes, settings, deployments).
  fullyParallel: false,
  workers: 1,
  timeout: 5 * 60_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './e2e/support/globalSetup.ts',
  use: {
    baseURL: process.env.ADMIN_CONSOLE_E2E_BASE_URL ?? 'http://localhost:3100',
    storageState: 'e2e/.auth/admin.json',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
