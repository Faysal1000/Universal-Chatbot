import type { LauncherCopy } from './launcherCopy';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const PANEL_ID = 'ucb-panel';

/** The DOM the element owns directly: launcher and panel frame. The chat inside the frame is the panel's. */
export interface WidgetView {
  root: HTMLDivElement;
  launcher: HTMLButtonElement;
  labelText: HTMLSpanElement;
  launcherOrb: HTMLCanvasElement;
  loadingOrb: HTMLCanvasElement;
  panel: HTMLElement;
  panelBody: HTMLDivElement;
}

function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className: string,
  children: Node[] = [],
): HTMLElementTagNameMap[Tag] {
  const created = document.createElement(tag);
  created.className = className;
  created.append(...children);
  return created;
}

/** The orb and the canvas a `RibbonOrb` draws on; also reused, larger, as the panel's loading state. */
function createOrb(): { orb: HTMLSpanElement; canvas: HTMLCanvasElement } {
  const canvas = element('canvas', 'ucb-orb-canvas');
  const orb = element('span', 'ucb-orb', [canvas]);
  orb.setAttribute('aria-hidden', 'true');
  return { orb, canvas };
}

function createCloseIcon(): HTMLSpanElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', 'M18 6 6 18M6 6l12 12');
  svg.append(path);
  return element('span', 'ucb-close-icon', [svg]);
}

export function createWidgetView(copy: LauncherCopy): WidgetView {
  const labelText = element('span', 'ucb-label-text');
  const { orb, canvas: launcherOrb } = createOrb();
  orb.append(createCloseIcon());
  const launcher = element('button', 'ucb-launcher', [orb, element('span', 'ucb-label', [labelText])]);
  launcher.type = 'button';
  launcher.setAttribute('aria-controls', PANEL_ID);
  launcher.setAttribute('aria-expanded', 'false');
  launcher.dataset.testid = 'chat-launcher';

  const loading = createOrb();
  const panelBody = element('div', 'ucb-panel-loading', [loading.orb]);
  // Focus lands here while the chat is still loading, so it is already inside the dialog.
  panelBody.tabIndex = -1;
  const panel = element('section', 'ucb-panel', [panelBody]);
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', copy.dialog);
  panel.inert = true;

  const root = element('div', 'ucb-root', [launcher, panel]);
  return { root, launcher, labelText, launcherOrb, loadingOrb: loading.canvas, panel, panelBody };
}
