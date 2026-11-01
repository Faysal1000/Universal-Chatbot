import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineUniversalChatBot, ELEMENT_NAME } from './UniversalChatBotElement';
import type { PanelHandle, PanelMountOptions } from './panelContract';

const panelHandle = vi.hoisted((): { [Method in keyof PanelHandle]: ReturnType<typeof vi.fn> } => ({
  setOpen: vi.fn(),
  setLanguage: vi.fn(),
  unmount: vi.fn(),
}));
const mountPanel = vi.hoisted(() => vi.fn((_options: PanelMountOptions) => panelHandle));
vi.mock('../panel/mountPanel', () => ({ mountPanel }));

type UniversalChatBotElement = ReturnType<typeof addWidget>;

const VALID_ATTRIBUTES = { 'api-key': 'pk_0123456789abcdefghijKLMN', 'api-url': 'https://rag.example.com' };

function addWidget(attributes: Record<string, string> = VALID_ATTRIBUTES) {
  const widget = document.createElement(ELEMENT_NAME);
  for (const [name, value] of Object.entries(attributes)) widget.setAttribute(name, value);
  document.body.append(widget);
  return widget;
}

function part(widget: UniversalChatBotElement, selector: string): HTMLElement {
  const found = widget.shadowRoot?.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`Nothing matches ${selector} in the widget`);
  return found;
}

const launcherOf = (widget: UniversalChatBotElement) => part(widget, '.ucb-launcher');
const rootOf = (widget: UniversalChatBotElement) => part(widget, '.ucb-root');
const flushPanelLoad = () => vi.dynamicImportSettled();

beforeAll(() => {
  // jsdom has no adopted stylesheets.
  if (!Array.isArray(document.createElement('div').attachShadow({ mode: 'open' }).adoptedStyleSheets)) {
    const sheets = new WeakMap<ShadowRoot, CSSStyleSheet[]>();
    Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', {
      get(this: ShadowRoot) {
        return sheets.get(this) ?? [];
      },
      set(this: ShadowRoot, value: CSSStyleSheet[]) {
        sheets.set(this, value);
      },
    });
  }
  defineUniversalChatBot();
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('<universal-chat-bot>', () => {
  it('shows the "Chat" pill at the bottom right by default', () => {
    const widget = addWidget();
    expect(launcherOf(widget)).toHaveTextContent('Chat');
    expect(launcherOf(widget)).toHaveAttribute('aria-expanded', 'false');
    expect(rootOf(widget).dataset).toMatchObject({ vertical: 'bottom', horizontal: 'right' });
  });

  it('draws nothing and explains why when the key is missing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const widget = addWidget({ 'api-url': 'https://rag.example.com' });
    expect(widget.shadowRoot?.childElementCount).toBe(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('api-key attribute is missing'));
  });

  it('moves when the position attribute changes', () => {
    const widget = addWidget();
    widget.setAttribute('position', 'middle-left');
    expect(rootOf(widget).dataset).toMatchObject({ vertical: 'middle', horizontal: 'left' });
  });

  it('collapses the greeting to the orb after its duration', () => {
    vi.useFakeTimers();
    const widget = addWidget({ ...VALID_ATTRIBUTES, greeting: 'Questions?', 'greeting-duration-ms': '3000' });
    expect(launcherOf(widget)).toHaveTextContent('Questions?');
    expect(rootOf(widget).dataset.collapsed).toBe('false');
    vi.advanceTimersByTime(3000);
    expect(rootOf(widget).dataset.collapsed).toBe('true');
  });

  it('opens the chat panel on click and announces it', async () => {
    const widget = addWidget();
    const opened = vi.fn();
    widget.addEventListener('chat-open', opened);

    launcherOf(widget).click();
    await flushPanelLoad();

    expect(widget.isOpen).toBe(true);
    expect(widget).toHaveAttribute('open');
    expect(launcherOf(widget)).toHaveAttribute('aria-expanded', 'true');
    expect(launcherOf(widget)).toHaveAccessibleName('Close chat');
    expect(opened).toHaveBeenCalledOnce();
    expect(mountPanel.mock.calls[0]?.[0].settings.apiUrl).toBe('https://rag.example.com');
    expect(panelHandle.setOpen).toHaveBeenLastCalledWith(true);
  });

  it('closes on Escape inside the panel and gives focus back to the launcher', async () => {
    const widget = addWidget();
    widget.open();
    await flushPanelLoad();

    part(widget, '#ucb-panel').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );

    expect(widget.isOpen).toBe(false);
    expect(widget.shadowRoot?.activeElement).toBe(launcherOf(widget));
    expect(panelHandle.setOpen).toHaveBeenLastCalledWith(false);
  });

  it('moves the launcher by its offsets', () => {
    const widget = addWidget({ ...VALID_ATTRIBUTES, 'offset-y': '120' });
    widget.setAttribute('offset-x', '2rem');
    const root = part(widget, '.ucb-root');
    expect(root.style.getPropertyValue('--ucb-offset-y')).toBe('120px');
    expect(root.style.getPropertyValue('--ucb-offset-x')).toBe('2rem');
  });

  it('keeps a second widget on the same page hidden', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    addWidget();
    const second = addWidget();
    expect(second.shadowRoot?.childElementCount).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('only one widget per page'));
  });
});
