import { expect, test } from '@playwright/test';

import { ChatPage, submittedTurn } from './chatPage';
import { FIXTURE_DOCUMENT_TITLE, FIXTURE_QUESTION } from './support/fixtureDocument';
import { applyDefaultChatbotSwitches, RAG_API_URL, setChatbotSwitches } from './support/ragAdminApi';
import { cutOpenEventStreams } from './support/streamCuttingProxy';

// The app reads `/config` (and with it `features.reasoning`) when it starts, so settings change before `open()`.
// Most tests run without reasoning: a small CPU model can spend its whole budget thinking.
test.beforeEach(() => applyDefaultChatbotSwitches());

test.describe('answers', () => {
  test('streams a cited answer from the fixture document and opens the source preview', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.open();
    await chat.send(FIXTURE_QUESTION);

    await chat.waitForReplyComplete();
    await expect(chat.lastReply).toContainText(/0?8[:.]15/);
    // Reasoning is off: no reasoning section at all.
    await expect(chat.lastReply.getByRole('button', { name: /Thinking|Thought for|Reasoning/ })).toHaveCount(
      0,
    );

    const fixtureSource = chat.lastReply.getByRole('button', {
      name: new RegExp(`Open source \\d+: ${FIXTURE_DOCUMENT_TITLE}`),
    });
    await fixtureSource.first().click();
    const panel = page.getByRole('dialog');
    await expect(panel).toContainText(FIXTURE_DOCUMENT_TITLE);
    await expect(panel).toContainText('Page 1');
    await expect(panel).toContainText('Orion Lighthouse');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // rag titles the conversation after its first message.
    await expect(chat.sidebar.getByRole('button', { name: /What time does the Orion/ })).toBeVisible();
  });

  test('shows no sources at all when the admin turns them off', async ({ page }) => {
    await setChatbotSwitches({ showReasoning: false, showSources: false });
    const chat = new ChatPage(page);
    const turnStreams: Promise<string>[] = [];
    page.on('response', (response) => {
      if (response.url().endsWith('/turns')) turnStreams.push(response.text());
    });
    await chat.open();
    await chat.send(FIXTURE_QUESTION);
    await chat.waitForReplyComplete();

    const assertNoSources = async () => {
      await expect(chat.lastReply.getByRole('button', { name: /Open source/ })).toHaveCount(0);
      await expect(chat.lastReply.getByRole('region', { name: 'Sources' })).toHaveCount(0);
      expect(await chat.lastAnswerText()).not.toMatch(/\[\d+\]/);
    };
    await assertNoSources();
    const streams = await Promise.all(turnStreams);
    expect(streams).toHaveLength(1);
    expect(streams[0]).not.toContain('event: answer.citations');
    // History from the server is shown the same way.
    await page.reload();
    await expect(chat.lastReply).toHaveAttribute('data-phase', 'complete');
    await assertNoSources();
  });

  test('streams the reasoning first when the admin enables it', async ({ page }) => {
    await setChatbotSwitches({ showReasoning: true, showSources: true });
    const chat = new ChatPage(page);
    await chat.open();
    await chat.send(FIXTURE_QUESTION);

    const reasoningToggle = chat.lastReply.getByRole('button', { name: /Thinking/ });
    await expect(reasoningToggle).toBeVisible({ timeout: 120_000 });
    // Open while the model thinks, so the reasoning streams in view.
    await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(chat.lastReply.getByTestId('reasoning-content')).not.toBeEmpty();
    await chat.stopButton.click();
    await expect(chat.lastReply).toHaveAttribute('data-phase', 'stopped');
  });

  test('only the latest turn can be edited, and editing replaces it', async ({ page }) => {
    const chat = new ChatPage(page);
    const turnRequests = chat.recordTurnRequests();
    await chat.open();

    await chat.send('When is the Dhaka office open?');
    await chat.waitForReplyComplete();
    await chat.send('How many days of annual leave do employees get?');
    await chat.waitForReplyComplete();

    const [first, latest] = [chat.userMessages.first(), chat.userMessages.last()];
    await first.hover();
    await expect(first.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await latest.hover();
    await latest.getByRole('button', { name: 'Edit' }).click();
    const editor = page.getByRole('textbox', { name: 'Edit' });
    await editor.fill('How many unused leave days can be carried over?');
    await editor.press('Enter');

    await expect.poll(() => turnRequests.length).toBe(3);
    const replacement = submittedTurn(turnRequests[2]!);
    expect(replacement.replacesTurnId).toBe(submittedTurn(turnRequests[1]!).turnId);
    expect(replacement.messages.map((m) => m.content)).toEqual([
      'How many unused leave days can be carried over?',
    ]);
    await chat.waitForReplyComplete();
    await expect(chat.replies).toHaveCount(2);
  });

  test('a dropped connection is resumed without losing or duplicating text', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.open();
    // Long enough to cut mid-answer, short enough for rag's 120 s generation limit on a CPU model.
    await chat.send('How must business travel be booked, and which flight class is used?');

    await expect(chat.lastReply).toHaveAttribute('data-phase', 'answering', { timeout: 120_000 });
    const resumed = page.waitForRequest((request) => request.url().endsWith('/events'));
    await cutOpenEventStreams();
    await resumed;

    await chat.waitForReplyComplete();
    const streamedText = await chat.lastAnswerText();
    // The stored answer (reloaded from history) must equal what was streamed across the reconnect.
    await page.reload();
    await expect(chat.lastReply).toHaveAttribute('data-phase', 'complete');
    expect(await chat.lastAnswerText()).toBe(streamedText);
  });

  test('follows the newer turn when the server supersedes a turn', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.open();
    const sessionToken = await chat.visitorSessionToken();
    const firstTurnRequest = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/turns'),
    );
    // Two messages make rag rewrite the query first, which leaves time before the first answer token.
    await chat.send('Hello');
    await chat.send('When is the Dhaka office open?');
    const conversationPath = new URL((await firstTurnRequest).url()).pathname;
    // Wait until rag runs the turn: the supersede path is only exercised once the first turn has left rag's queue.
    await expect(chat.lastReply.getByTestId('reply-stage')).toHaveText(/Understanding your question/, {
      timeout: 60_000,
    });

    // The same visitor sends another turn from "another tab" before the first answers: rag moves the first
    // turn's messages into the new turn and tells the page to follow it.
    const otherTabTurnId = crypto.randomUUID();
    const followed = page.waitForRequest((request) =>
      request.url().endsWith(`/turns/${otherTabTurnId}/events`),
    );
    const otherTab = page.request.post(`${RAG_API_URL}${conversationPath}`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        Accept: 'text/event-stream',
        'Idempotency-Key': otherTabTurnId,
      },
      data: {
        turnId: otherTabTurnId,
        messages: [
          { clientMessageId: crypto.randomUUID(), content: 'And on public holidays?', attachmentIds: [] },
        ],
      },
      timeout: 180_000,
    });

    await followed;
    await chat.waitForReplyComplete();
    expect((await otherTab).status()).toBe(200);
    await expect(chat.replies).toHaveCount(1);

    await page.reload();
    await expect(chat.replies).toHaveCount(1);
    await expect(chat.userMessages).toHaveText([
      /Hello/,
      /When is the Dhaka office open\?/,
      /And on public holidays\?/,
    ]);
  });
});

test.describe('attachments', () => {
  test('uploads an image with preview, rejects invalid files and sends it with the turn', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    const turnRequests = chat.recordTurnRequests();
    await chat.open();
    // 8×8 red PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
      'base64',
    );
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([
      { name: 'red.png', mimeType: 'image/png', buffer: png },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    ]);
    await expect(page.getByRole('alert').filter({ hasText: 'only JPEG, PNG and WEBP' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove red.png' })).toBeVisible();

    await fileInput.setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]),
    });
    await expect(page.getByRole('alert').filter({ hasText: 'larger than 5 MiB' })).toBeVisible();

    await chat.send('What colour is this picture?');
    await chat.waitForReplyFinished();
    expect(submittedTurn(turnRequests[0]!).messages[0]!.attachmentIds).toHaveLength(1);
    const attachment = chat.userMessages.getByRole('img', { name: 'Attached image 1' });
    await expect(attachment).toBeVisible();
    // Served by rag through a signed, short-lived URL.
    expect(await attachment.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  });
});

test.describe('conversations and navigation', () => {
  test('conversations can be renamed, searched and deleted', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.open();
    await chat.send('How many days of annual leave do employees get?');
    await chat.waitForReplyFinished();

    const item = chat.sidebar.getByRole('listitem').filter({ hasText: 'How many days of annual leave' });
    await item.hover();
    await item.getByRole('button', { name: 'Conversation options' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const titleInput = chat.sidebar.getByRole('textbox', { name: 'Conversation title' });
    await titleInput.fill('Leave questions');
    await titleInput.press('Enter');
    await expect(chat.sidebar.getByRole('button', { name: 'Leave questions' })).toBeVisible();

    const search = chat.sidebar.getByRole('searchbox', { name: 'Search conversations' });
    await search.fill('Leave questions');
    await expect(chat.sidebar.getByRole('button', { name: 'Leave questions' })).toBeVisible();
    await search.fill('');

    const renamed = chat.sidebar.getByRole('listitem').filter({ hasText: 'Leave questions' });
    await renamed.hover();
    await renamed.getByRole('button', { name: 'Conversation options' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(chat.sidebar.getByRole('button', { name: 'Leave questions' })).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });

  test('keyboard shortcuts: new chat and shortcut help', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.open();
    await chat.send('hello');
    await expect(page).toHaveURL(/\/c\//, { timeout: 30_000 });
    await chat.waitForReplyFinished();

    await page.keyboard.press('ControlOrMeta+Shift+O');
    await expect(page).toHaveURL(/\/$/);
    await expect(chat.composer).toBeFocused();

    await page.keyboard.press('ControlOrMeta+/');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });
});
