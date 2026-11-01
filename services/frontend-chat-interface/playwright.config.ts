import { defineConfig, devices } from '@playwright/test';

import { STREAM_CUTTING_PROXY_PORT } from './e2e/support/streamCuttingProxy';

/**
 * End-to-end tests run the real app against the real platform: the root docker-compose stack (rag, llm-gateway,
 * local-llm, embedding-server and their stores), started with e2e/stack/compose.e2e.yml for Turnstile test keys.
 * Vite proxies `/v1` to rag through e2e/support/streamCuttingProxy.ts, which can cut answer streams. Answers
 * come from a small CPU model, so timeouts are generous.
 * The batching quiet window is pinned to 1.5 s so timing is predictable while still exercising the real scheduler.
 */
const WEB_PORT = 5290;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  // One worker: the tests share rag's rate limits and its chatbot settings.
  fullyParallel: false,
  workers: 1,
  timeout: 4 * 60_000,
  expect: { timeout: 15_000 },
  // A small model occasionally answers without citation markers; one retry absorbs that.
  retries: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${WEB_PORT} --strictPort`,
    url: `http://localhost:${WEB_PORT}`,
    env: {
      CHAT_DEV_RAG_API_URL: `http://127.0.0.1:${STREAM_CUTTING_PROXY_PORT}`,
      VITE_CHAT_BATCH_QUIET_MIN_MS: '1500',
      VITE_CHAT_BATCH_QUIET_MAX_MS: '1500',
      VITE_CHAT_BATCH_MAX_WAIT_MS: '10000',
    },
    reuseExistingServer: false,
  },
});
