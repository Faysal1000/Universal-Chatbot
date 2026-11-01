import { beforeEach, describe, expect, it } from 'vitest';

import { tabbableElements, trapTabKey } from './focusTrap';

function panelWithButtons(): { panel: HTMLElement; first: HTMLButtonElement; last: HTMLButtonElement } {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const panel = document.createElement('section');
  panel.innerHTML =
    '<button id="first">First</button><button disabled>Off</button><div inert><button>Inert</button></div>' +
    '<textarea id="composer"></textarea><button id="last">Last</button>';
  shadow.append(panel);
  return {
    panel,
    first: panel.querySelector<HTMLButtonElement>('#first')!,
    last: panel.querySelector<HTMLButtonElement>('#last')!,
  };
}

function tab(panel: HTMLElement, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
  trapTabKey(event, panel);
  return event;
}

describe('focus trap', () => {
  beforeEach(() => {
    // jsdom has no layout; treat every element as rendered.
    HTMLElement.prototype.getClientRects = () => [new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList;
  });

  it('skips disabled and inert elements', () => {
    const { panel } = panelWithButtons();
    expect(tabbableElements(panel).map((element) => element.id)).toEqual(['first', 'composer', 'last']);
  });

  it('wraps Tab from the last element to the first, inside a shadow root', () => {
    const { panel, first, last } = panelWithButtons();
    last.focus();
    const event = tab(panel);
    expect(event.defaultPrevented).toBe(true);
    expect((panel.getRootNode() as ShadowRoot).activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    const { panel, first, last } = panelWithButtons();
    first.focus();
    tab(panel, true);
    expect((panel.getRootNode() as ShadowRoot).activeElement).toBe(last);
  });

  it('lets Tab move normally between inner elements', () => {
    const { panel, first } = panelWithButtons();
    first.focus();
    expect(tab(panel).defaultPrevented).toBe(false);
  });
});
