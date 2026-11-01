import { expect, test } from '@playwright/test';

import {
  ALLOWED_DEMO_ORIGIN,
  applyDefaultChatbotSwitches,
  FIXTURE_DOCUMENT_TITLE,
  FIXTURE_QUESTION,
  FOREIGN_DEMO_ORIGIN,
  setChatbotSwitches,
} from './support/stack';
import { createWidgetKey, revokeWidgetKey } from './support/widgetKeys';
import { WidgetPage } from './widgetPage';

test.beforeEach(() => applyDefaultChatbotSwitches());

test.describe('answers on an allowed website', () => {
  test('streams a cited answer in the React host and opens its source in the panel', async ({ page }) => {
    const widget = new WidgetPage(page);
    await widget.goto('react');
    await widget.openAndWaitForChat();
    await expect(page.getByTestId('open-count')).toHaveText('Chat opened 1 times');

    await widget.ask(FIXTURE_QUESTION);
    await expect(widget.lastReply).toContainText(/0?8[:.]15/);
    const source = widget.lastReply.getByRole('button', {
      name: new RegExp(`Open source \\d+: ${FIXTURE_DOCUMENT_TITLE}`),
    });
    await source.first().click();
    const sheet = widget.dialog.getByRole('dialog', { name: FIXTURE_DOCUMENT_TITLE });
    await expect(sheet).toContainText('Page 1');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    // Escape inside the source sheet closes only the sheet.
    await expect(widget.dialog).toBeVisible();
  });

  test('shows no sources when the admin turns them off (Vue host)', async ({ page }) => {
    await setChatbotSwitches({ showReasoning: false, showSources: false });
    const widget = new WidgetPage(page);
    await widget.goto('vue');
    await widget.openAndWaitForChat();
    await widget.ask(FIXTURE_QUESTION);
    await expect(widget.lastReply.getByRole('button', { name: /Open source/ })).toHaveCount(0);
    expect(await widget.lastReply.innerText()).not.toMatch(/\[\d+\]/);
  });
});

test.describe('website restrictions', () => {
  test('refuses to chat on a website the key does not list', async ({ page }) => {
    const widget = new WidgetPage(page);
    await widget.goto('plain', {}, FOREIGN_DEMO_ORIGIN);
    await widget.launcher.click();
    await expect(widget.dialog.getByRole('alert')).toContainText('could not be reached', { timeout: 30_000 });
    await expect(widget.composer).toHaveCount(0);
  });

  test('stops working once the key is revoked', async ({ page }) => {
    const temporaryKey = await createWidgetKey('Chat widget e2e: revoked', [ALLOWED_DEMO_ORIGIN]);
    await revokeWidgetKey(temporaryKey.id);
    const widget = new WidgetPage(page);
    await widget.goto('plain', { 'api-key': temporaryKey.publishableKey });
    await widget.launcher.click();
    await expect(widget.dialog.getByRole('alert')).toContainText('could not be reached', { timeout: 30_000 });
  });
});

test.describe('launcher', () => {
  test('shows the greeting, then folds it into the orb', async ({ page }) => {
    const widget = new WidgetPage(page);
    await widget.goto('plain', { greeting: 'Questions? Ask us', 'greeting-duration-ms': '1500' });
    await expect(widget.launcher).toContainText('Questions? Ask us');
    await expect.poll(() => widget.rootState('collapsed')).toBe('false');
    const openWidth = (await widget.launcher.boundingBox())?.width ?? 0;
    await expect.poll(() => widget.rootState('collapsed'), { timeout: 5_000 }).toBe('true');
    await expect
      .poll(async () => (await widget.launcher.boundingBox())?.width ?? 0)
      .toBeLessThan(openWidth / 2);
  });

  const POSITIONS = ['top', 'middle', 'bottom'].flatMap((vertical) =>
    ['left', 'center', 'right'].map((horizontal) => ({ vertical, horizontal })),
  );
  for (const { vertical, horizontal } of POSITIONS) {
    test(`sits at ${vertical}-${horizontal} and opens its panel inside the window`, async ({ page }) => {
      const widget = new WidgetPage(page);
      await widget.goto('plain', { position: `${vertical}-${horizontal}`, 'greeting-duration-ms': '0' });
      const viewport = page.viewportSize() ?? { width: 0, height: 0 };
      const launcher = await widget.launcher.boundingBox();
      if (!launcher) throw new Error('launcher not laid out');
      const centreX = launcher.x + launcher.width / 2;
      const centreY = launcher.y + launcher.height / 2;
      const expectedX = { left: 0.0, center: 0.5, right: 1.0 }[horizontal] ?? 0;
      const expectedY = { top: 0.0, middle: 0.5, bottom: 1.0 }[vertical] ?? 0;
      expect(Math.abs(centreX - expectedX * viewport.width)).toBeLessThan(80);
      expect(Math.abs(centreY - expectedY * viewport.height)).toBeLessThan(80);

      await widget.launcher.click();
      await expect(widget.dialog).toBeVisible();
      await expect.poll(async () => isInside(await widget.dialog.boundingBox(), viewport)).toBe(true);
    });
  }
});

test.describe('keyboard and screen readers', () => {
  test('opens from the keyboard, traps Tab inside, and closes with Escape back to the launcher', async ({
    page,
  }) => {
    const widget = new WidgetPage(page);
    await widget.goto('plain');
    await expect(widget.launcher).toHaveAccessibleName(/Chat/);
    await widget.launcher.focus();
    await page.keyboard.press('Enter');
    await expect(widget.launcher).toHaveAttribute('aria-expanded', 'true');
    await expect(widget.dialog).toHaveAttribute('aria-modal', 'true');
    await expect(widget.composer).toBeFocused({ timeout: 60_000 });

    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInsideWidget(widget)).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(widget.dialog).toBeHidden();
    await expect(widget.launcher).toBeFocused();
    await expect(widget.launcher).toHaveAttribute('aria-expanded', 'false');
  });

  test('fills a phone screen and keeps the page behind from scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const widget = new WidgetPage(page);
    await widget.goto('plain');
    await widget.openAndWaitForChat();
    const panel = await widget.dialog.boundingBox();
    expect(panel?.width).toBeGreaterThanOrEqual(388);
    expect(panel?.height).toBeGreaterThanOrEqual(840);
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
    await widget.dialog.getByRole('button', { name: 'Close chat' }).click();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  });
});

function isInside(
  box: { x: number; y: number; width: number; height: number } | null,
  viewport: { width: number; height: number },
): boolean {
  if (!box || box.width === 0) return false;
  return (
    box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height
  );
}

/** Focus stays in the widget: the document's active element is the widget host (focus is inside its shadow root). */
function focusIsInsideWidget(widget: WidgetPage): Promise<boolean> {
  return widget.page.evaluate(() => document.activeElement?.tagName.toLowerCase() === 'universal-chat-bot');
}
