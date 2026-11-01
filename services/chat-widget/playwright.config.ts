import { defineConfig, devices } from '@playwright/test';

import { DEMO_PORT } from './e2e/support/stack';

/**
 * End-to-end tests load the BUILT widget into the demo host pages (plain HTML, React, Vue) and talk to the real
 * platform: the root docker-compose stack with the chat app's e2e overlay (Turnstile test keys, shared-IP limits).
 * The widget calls rag straight from the page, so CORS and the widget-key origin checks run for real. Answers come
 * from a small CPU model, so timeouts are generous.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  // One worker: tests share rag's chatbot settings and rate limits.
  fullyParallel: false,
  workers: 1,
  timeout: 4 * 60_000,
  expect: { timeout: 15_000 },
  // A small model occasionally answers without citation markers; one retry absorbs that.
  retries: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: `http://localhost:${DEMO_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run demo',
    url: `http://localhost:${DEMO_PORT}/plain/`,
    env: { CHAT_WIDGET_DEMO_PORT: String(DEMO_PORT) },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
