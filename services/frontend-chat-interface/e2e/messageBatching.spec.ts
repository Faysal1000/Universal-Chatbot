import { expect, test } from '@playwright/test';

import { ChatPage, submittedTurn } from './chatPage';
import { applyDefaultChatbotSwitches } from './support/ragAdminApi';

// Against the real rag API: the scheduler's decisions are asserted on the requests the browser actually sends,
// and every batch must come back as exactly one streamed reply.
test.describe('message batching', () => {
  test.beforeAll(() => applyDefaultChatbotSwitches());

  test('quick successive messages are shown at once but sent as ONE turn with ONE reply', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    const turnRequests = chat.recordTurnRequests();
    await chat.open();

    await chat.send('hi');
    await chat.send('I have a question');
    await chat.send('how many days of annual leave do employees get?');

    // Optimistic UI: all three are visible immediately as pending, nothing sent yet.
    await expect(chat.pendingMessages).toHaveCount(3);
    expect(turnRequests).toHaveLength(0);

    await chat.waitForReplyComplete();
    expect(turnRequests).toHaveLength(1);
    const turn = submittedTurn(turnRequests[0]!);
    expect(turn.messages.map((m) => m.content)).toEqual([
      'hi',
      'I have a question',
      'how many days of annual leave do employees get?',
    ]);
    expect(turnRequests[0]!.headers()['idempotency-key']).toBe(turn.turnId);
    expect(turnRequests[0]!.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    await expect(chat.replies).toHaveCount(1);
    await expect(chat.lastReply.locator('.markdown-body')).not.toBeEmpty();
    await expect(chat.userMessages).toHaveCount(3);
  });

  test('typing restarts the quiet window', async ({ page }) => {
    const chat = new ChatPage(page);
    const turnRequests = chat.recordTurnRequests();
    await chat.open();

    await chat.send('hello');
    // Keep typing for well over one window (1.5 s): nothing may be sent meanwhile.
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(400);
      await chat.composer.pressSequentially('x');
    }
    expect(turnRequests).toHaveLength(0);
    await chat.composer.fill('when is the Dhaka office open?');
    await chat.composer.press('Enter');

    await chat.waitForReplyComplete();
    expect(turnRequests).toHaveLength(1);
    expect(submittedTurn(turnRequests[0]!).messages).toHaveLength(2);
  });

  test('pending messages can be edited or removed before they are sent', async ({ page }) => {
    const chat = new ChatPage(page);
    const turnRequests = chat.recordTurnRequests();
    await chat.open();

    await chat.send('remove me');
    await chat.send('how many days of leave?');
    await chat.pendingMessages.first().getByRole('button', { name: 'Remove pending message' }).click();
    await expect(chat.pendingMessages).toHaveCount(1);

    await chat.pendingMessages.first().getByRole('button', { name: 'Edit pending message' }).click();
    const editor = page.getByRole('textbox', { name: 'Edit' });
    await editor.fill('how much annual leave do I get?');
    await editor.press('Enter');
    await expect(chat.pendingMessages.first()).toContainText('annual leave');

    await expect.poll(() => turnRequests.length).toBe(1);
    expect(submittedTurn(turnRequests[0]!).messages.map((m) => m.content)).toEqual([
      'how much annual leave do I get?',
    ]);
    await chat.waitForReplyComplete();
  });

  test('only Stop is offered while a reply is on its way; after stopping the next question goes out', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    const turnRequests = chat.recordTurnRequests();
    await chat.open();

    await chat.send('Summarise the travel expense policy in detail.');
    await expect(chat.stopButton).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Send message' })).toBeHidden();
    await chat.composer.fill('follow-up');
    await chat.composer.press('Enter');
    await expect(chat.pendingMessages).toHaveCount(0);
    expect(turnRequests).toHaveLength(1);

    await chat.stopButton.click();
    await expect(chat.replies.first()).toHaveAttribute('data-phase', 'stopped');
    await chat.composer.press('Enter');
    await expect.poll(() => turnRequests.length, { timeout: 10_000 }).toBe(2);
    expect(submittedTurn(turnRequests[1]!).messages.map((m) => m.content)).toEqual(['follow-up']);
    await chat.waitForReplyFinished();
  });

  test('pending messages survive a page reload and are still sent', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.open();
    await chat.send('how many unused leave days can be carried over?');
    await page.reload();
    await expect(chat.pendingMessages.or(chat.userMessages)).toContainText('carried over');
    await chat.waitForReplyComplete();
  });
});
