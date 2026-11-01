import { expect, test } from '@playwright/test';

import { ChatPage } from './chatPage';
import { applyDefaultChatbotSwitches } from './support/ragAdminApi';

const MAX_ATTEMPTS = 12;

// Runs last (files run in name order): it spends the visitor's per-minute turn allowance on purpose.
test('rate limiting shows a Retry-After countdown and the request id', async ({ page }) => {
  await applyDefaultChatbotSwitches();
  const chat = new ChatPage(page);
  await chat.open();
  const rateLimitNotice = chat.lastReply
    .getByRole('alert')
    .filter({ hasText: 'You are sending messages too quickly.' });

  // rag allows a handful of turns per minute per session: start and stop turns until it refuses one.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await chat.send(`Rate limit probe ${attempt}`);
    await expect(chat.lastReply).toHaveAttribute('data-phase', /waiting|thinking|answering|error/);
    if (await rateLimitNotice.isVisible()) break;
    // The refusal can arrive while the Stop button is still on screen; then the click finds nothing to stop.
    await chat.stopButton.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(chat.lastReply).toHaveAttribute('data-phase', /stopped|error/);
    if (await rateLimitNotice.isVisible()) break;
  }

  await expect(rateLimitNotice).toBeVisible();
  await expect(rateLimitNotice).toContainText(/Reference: [0-9a-f-]{36}/);
  await expect(chat.lastReply.getByRole('button', { name: /Retry in \d+s/ })).toBeDisabled();
});
