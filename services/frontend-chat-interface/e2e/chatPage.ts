import { expect, type Page, type Request } from '@playwright/test';

/** A real model on CPU: one answer can take a minute or more. */
const REPLY_TIMEOUT_MS = 3 * 60_000;

/** Page object for the chat UI: keeps selectors in one place so specs read as user stories. */
export class ChatPage {
  constructor(readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto('/');
    await expect(this.composer).toBeVisible({ timeout: 30_000 });
  }

  get composer() {
    return this.page.getByRole('textbox', { name: 'Message' });
  }

  get pendingMessages() {
    return this.page.getByTestId('pending-message');
  }

  get userMessages() {
    return this.page.getByTestId('user-message');
  }

  get replies() {
    return this.page.getByTestId('assistant-reply');
  }

  get lastReply() {
    return this.replies.last();
  }

  get stopButton() {
    return this.page.getByRole('button', { name: 'Stop generating' });
  }

  get sidebar() {
    return this.page.getByRole('navigation');
  }

  async send(text: string): Promise<void> {
    await this.composer.fill(text);
    await this.composer.press('Enter');
  }

  async waitForReplyFinished(): Promise<void> {
    await expect(this.lastReply).toHaveAttribute('data-phase', /complete|stopped|error/, {
      timeout: REPLY_TIMEOUT_MS,
    });
  }

  /** Waits for the reply to end, then fails at once (with its error text) unless it completed. */
  async waitForReplyComplete(): Promise<void> {
    await this.waitForReplyFinished();
    const phase = await this.lastReply.getAttribute('data-phase');
    expect(phase, await this.lastReply.innerText()).toBe('complete');
  }

  /** The last answer's text with whitespace collapsed and rendered math left out (its DOM text varies). */
  lastAnswerText(): Promise<string> {
    return this.lastReply.locator('.markdown-body').evaluate((answer) => {
      const copy = answer.cloneNode(true) as HTMLElement;
      for (const math of copy.querySelectorAll('.katex')) math.remove();
      return copy.textContent.replace(/\s+/g, ' ').trim();
    });
  }

  /** Records every turn submission (POST …/turns) made by the page. */
  recordTurnRequests(): Request[] {
    const requests: Request[] = [];
    this.page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/conversations\/[^/]+\/turns$/.test(new URL(request.url()).pathname)
      ) {
        requests.push(request);
      }
    });
    return requests;
  }

  /** The visitor session token the app obtained (after Turnstile), for driving the API as the same visitor. */
  async visitorSessionToken(): Promise<string> {
    return this.page.evaluate(() => {
      const stored = localStorage.getItem('chat.visitorSession.v1');
      if (!stored) throw new Error('no visitor session yet');
      return (JSON.parse(stored) as { sessionToken: string }).sessionToken;
    });
  }

  conversationIdFromUrl(): string {
    const match = /\/c\/([^/?#]+)/.exec(this.page.url());
    if (!match?.[1]) throw new Error(`no conversation in ${this.page.url()}`);
    return match[1];
  }
}

export interface SubmittedTurn {
  turnId: string;
  replacesTurnId?: string | null;
  messages: { content: string; attachmentIds: string[] }[];
}

export function submittedTurn(request: Request): SubmittedTurn {
  return request.postDataJSON() as SubmittedTurn;
}
