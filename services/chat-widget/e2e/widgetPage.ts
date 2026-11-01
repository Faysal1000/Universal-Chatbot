import { expect, type Locator, type Page } from '@playwright/test';

export type DemoHost = 'plain' | 'react' | 'vue';

const REPLY_TIMEOUT_MS = 3 * 60_000;

/** Drives `<universal-chat-bot>` on a demo host page. Playwright's locators pierce the open shadow root. */
export class WidgetPage {
  constructor(readonly page: Page) {}

  /** Opens a demo page with the widget's attributes in the query string (the e2e key unless one is given). */
  async goto(host: DemoHost, attributes: Record<string, string> = {}, origin = ''): Promise<void> {
    const key = process.env.CHAT_WIDGET_E2E_KEY;
    if (!key) throw new Error('CHAT_WIDGET_E2E_KEY is not set; the global setup creates it');
    const query = new URLSearchParams({ 'api-key': key, 'api-url': 'http://localhost:8080', ...attributes });
    await this.page.goto(`${origin}/${host}/?${query.toString()}`);
    await expect(this.launcher).toBeVisible();
  }

  get widget(): Locator {
    return this.page.locator('universal-chat-bot');
  }

  get launcher(): Locator {
    return this.page.getByTestId('chat-launcher');
  }

  get dialog(): Locator {
    return this.page.getByRole('dialog', { name: /Assistant|Chat|চ্যাট/ });
  }

  get composer(): Locator {
    return this.dialog.getByRole('textbox', { name: 'Message' });
  }

  get lastReply(): Locator {
    return this.dialog.getByTestId('assistant-reply').last();
  }

  /** The shadow root's state flags (open, collapsed, theme, placement). */
  rootState(name: 'open' | 'collapsed' | 'vertical' | 'horizontal' | 'theme'): Promise<string | undefined> {
    return this.widget.evaluate(
      (element, key) => element.shadowRoot?.querySelector<HTMLElement>('.ucb-root')?.dataset[key],
      name,
    );
  }

  async openAndWaitForChat(): Promise<void> {
    await this.launcher.click();
    await expect(this.composer).toBeVisible({ timeout: 60_000 });
  }

  /** Sends at once (Cmd/Ctrl+Enter skips the 5–7 s batching window) and waits for the answer to finish. */
  async ask(question: string): Promise<void> {
    await this.composer.fill(question);
    await this.composer.press('ControlOrMeta+Enter');
    await expect(this.lastReply).toHaveAttribute('data-phase', /complete|stopped|error/, {
      timeout: REPLY_TIMEOUT_MS,
    });
    expect(await this.lastReply.getAttribute('data-phase'), await this.lastReply.innerText()).toBe(
      'complete',
    );
  }
}
