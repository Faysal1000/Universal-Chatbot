import { inkForBrandColor, resolveCssColor } from './brandColor';
import { trapTabKey } from './focusTrap';
import { addGlassRefraction } from './glassRefraction';
import { PageScrollLock } from './pageScrollLock';
import launcherStyles from './launcher.css?inline';
import { LAUNCHER_COPY } from './launcherCopy';
import { RibbonOrb } from './orb/RibbonOrb';
import type { MountPanel, PanelHandle } from './panelContract';
import { placementOf } from './widgetPosition';
import {
  readWidgetSettings,
  WIDGET_ATTRIBUTES,
  type SettingsProblem,
  type WidgetLanguage,
  type WidgetSettings,
} from './widgetSettings';
import {
  hasUnsentMessages,
  loadLanguagePreference,
  saveLanguagePreference,
  storageKeyPrefixFor,
} from './widgetStorage';
import { createWidgetView, type WidgetView } from './widgetView';

export const ELEMENT_NAME = 'universal-chat-bot';

/** Attributes whose change needs a new chat session (new key, new backend); the rest update in place. */
const CONNECTION_ATTRIBUTES: readonly string[] = ['api-key', 'api-url'];
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
const DEFAULT_ACCENT = '#6d5dfc';
/** Drawn at the collapsed button's size (launcher.css); the pill shows it smaller. */
const LAUNCHER_ORB_SIZE = 54;
const DEFAULT_ACCENT_INK = '#ffffff';
/** Matches launcher.css: where the panel covers the whole screen. */
const FULL_SCREEN_PANEL_QUERY = '(max-width: 639px), (max-height: 520px)';

const SETTINGS_PROBLEM_MESSAGES: Record<SettingsProblem, string> = {
  missing_api_key: 'the api-key attribute is missing.',
  invalid_api_key:
    'api-key must be a publishable widget key (pk_…) from the admin console. Never put a secret key in a page.',
  missing_api_url: 'the api-url attribute is missing.',
  invalid_api_url: 'api-url must be an http(s) URL.',
};

let panelModule: Promise<MountPanel> | null = null;

/** The chat panel's code, fetched once and shared; a failed fetch can be retried. */
function loadPanelModule(): Promise<MountPanel> {
  panelModule ??= import('../panel/mountPanel')
    .then((module) => module.mountPanel)
    .catch((error: unknown) => {
      panelModule = null;
      throw error;
    });
  return panelModule;
}

/**
 * `<universal-chat-bot>`: a launcher that opens a chat panel with the organisation's assistant.
 *
 * The element itself is small. It draws the launcher, places it, themes it and runs the label's collapse.
 * The chat panel (React, markdown, the shared chat core) loads on first use, or in the background when the
 * visitor has unsent messages from an earlier visit.
 */
export class UniversalChatBotElement extends HTMLElement {
  static readonly observedAttributes = [...WIDGET_ATTRIBUTES, 'open'];
  /** Only one widget per page: the chat's state is per page, and two launchers would compete for one corner. */
  private static activeInstance: UniversalChatBotElement | null = null;

  private readonly shadow: ShadowRoot;
  private view: WidgetView | null = null;
  private orbs: RibbonOrb[] = [];
  private settings: WidgetSettings | null = null;
  private language: WidgetLanguage = 'en';
  private panel: PanelHandle | null = null;
  private panelLoad: Promise<void> | null = null;
  private isPanelOpen = false;
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;
  private pageScrollLock: PageScrollLock | null = null;
  private readonly darkScheme = matchMedia(DARK_SCHEME_QUERY);
  private readonly onSchemeChange = () => this.applyTheme();
  private readonly onPanelKeyDown = (event: KeyboardEvent) => this.handlePanelKeyDown(event);

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  get isOpen(): boolean {
    return this.isPanelOpen;
  }

  open(): void {
    this.setOpen(true);
  }

  close(): void {
    this.setOpen(false);
  }

  toggle(): void {
    this.setOpen(!this.isPanelOpen);
  }

  connectedCallback(): void {
    if (UniversalChatBotElement.activeInstance && UniversalChatBotElement.activeInstance !== this) {
      console.warn(`<${ELEMENT_NAME}>: only one widget per page is supported; this one stays hidden.`);
      return;
    }
    UniversalChatBotElement.activeInstance = this;
    this.render();
    this.darkScheme.addEventListener('change', this.onSchemeChange);
    if (this.hasAttribute('open')) this.setOpen(true);
  }

  disconnectedCallback(): void {
    if (UniversalChatBotElement.activeInstance !== this) return;
    UniversalChatBotElement.activeInstance = null;
    this.darkScheme.removeEventListener('change', this.onSchemeChange);
    this.teardown();
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (UniversalChatBotElement.activeInstance !== this || previous === next) return;
    if (name === 'open') {
      this.setOpen(next !== null);
      return;
    }
    if (CONNECTION_ATTRIBUTES.includes(name)) {
      this.teardown();
      this.render();
      return;
    }
    this.applySettings();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────────────────────────────

  private render(): void {
    const result = readWidgetSettings((name) => this.getAttribute(name), document.documentElement.lang);
    if (!result.ok) {
      console.error(`<${ELEMENT_NAME}>: ${SETTINGS_PROBLEM_MESSAGES[result.problem]}`);
      return;
    }
    this.settings = result.settings;
    this.language = loadLanguagePreference(this.storagePrefix) ?? result.settings.language;
    this.adoptStyles(launcherStyles);
    this.view = createWidgetView(LAUNCHER_COPY[this.language]);
    this.view.launcher.addEventListener('click', () => this.toggle());
    // Fetch the panel while the pointer is on its way to the click.
    this.view.launcher.addEventListener('pointerenter', () => void loadPanelModule().catch(() => undefined));
    this.view.launcher.addEventListener('focus', () => void loadPanelModule().catch(() => undefined));
    // On the root, not the panel: the chat's own Escape handlers (on the panel's React root) run first.
    this.view.root.addEventListener('keydown', this.onPanelKeyDown);
    this.shadow.replaceChildren(this.view.root);
    this.view.root.dataset.refraction = String(addGlassRefraction(this.shadow));
    this.orbs = [
      new RibbonOrb(this.view.launcherOrb, LAUNCHER_ORB_SIZE),
      new RibbonOrb(this.view.loadingOrb, 64),
    ];
    this.applySettings();
    this.orbs.forEach((orb) => orb.play());
    this.scheduleLabelCollapse();
    if (hasUnsentMessages(this.storagePrefix)) void this.ensurePanel();
  }

  private applySettings(): void {
    const view = this.view;
    if (!view) return;
    const result = readWidgetSettings((name) => this.getAttribute(name), document.documentElement.lang);
    if (!result.ok) return;
    this.settings = result.settings;
    this.language = loadLanguagePreference(this.storagePrefix) ?? result.settings.language;
    const { vertical, horizontal } = placementOf(result.settings.position);
    view.root.dataset.vertical = vertical;
    view.root.dataset.horizontal = horizontal;
    view.root.style.setProperty('--ucb-offset-x', result.settings.offsetX);
    view.root.style.setProperty('--ucb-offset-y', result.settings.offsetY);
    this.applyBrandColor(result.settings);
    this.applyTheme();
    this.applyLanguage();
  }

  private applyBrandColor({ primaryColor }: WidgetSettings): void {
    const root = this.view?.root;
    if (!root) return;
    const brand = primaryColor === null ? null : resolveCssColor(primaryColor, root);
    if (primaryColor !== null && brand === null) {
      console.warn(
        `<${ELEMENT_NAME}>: primary-color "${primaryColor}" is not a CSS colour; using the default.`,
      );
    }
    root.style.setProperty('--accent', brand && primaryColor ? primaryColor : DEFAULT_ACCENT);
    root.style.setProperty('--accent-ink', brand ? inkForBrandColor(brand) : DEFAULT_ACCENT_INK);
  }

  private applyTheme(): void {
    const root = this.view?.root;
    if (!root || !this.settings) return;
    const theme = this.settings.theme;
    root.dataset.theme = theme === 'auto' ? (this.darkScheme.matches ? 'dark' : 'light') : theme;
  }

  private applyLanguage(): void {
    const view = this.view;
    if (!view || !this.settings) return;
    const copy = LAUNCHER_COPY[this.language];
    view.root.lang = this.language;
    view.labelText.textContent = this.settings.greeting ?? copy.label;
    view.panel.setAttribute('aria-label', copy.dialog);
    this.updateLauncherState();
    this.panel?.setLanguage(this.language);
  }

  private adoptStyles(cssText: string): void {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    this.shadow.adoptedStyleSheets = [...this.shadow.adoptedStyleSheets, sheet];
  }

  // ── Launcher label ─────────────────────────────────────────────────────────────────────────────────

  private scheduleLabelCollapse(): void {
    const view = this.view;
    if (!view || !this.settings) return;
    const delay = this.settings.greetingDurationMs;
    view.root.dataset.collapsed = String(delay === 0);
    if (delay === 0) return;
    this.collapseTimer = setTimeout(() => {
      view.root.dataset.collapsed = 'true';
    }, delay);
  }

  /** Open: the launcher becomes a close button. Closed: its accessible name is the visible label. */
  private updateLauncherState(): void {
    const view = this.view;
    if (!view) return;
    view.root.dataset.open = String(this.isPanelOpen);
    view.launcher.setAttribute('aria-expanded', String(this.isPanelOpen));
    if (this.isPanelOpen) {
      view.launcher.setAttribute('aria-label', LAUNCHER_COPY[this.language].close);
    } else {
      view.launcher.removeAttribute('aria-label');
    }
  }

  // ── Panel ──────────────────────────────────────────────────────────────────────────────────────────

  private setOpen(isOpen: boolean): void {
    const view = this.view;
    if (!view || isOpen === this.isPanelOpen) return;
    this.isPanelOpen = isOpen;
    view.panel.inert = !isOpen;
    this.updateLauncherState();
    this.toggleAttribute('open', isOpen);
    if (isOpen) this.orbs.forEach((orb) => orb.pause());
    else this.orbs.forEach((orb) => orb.play());
    if (isOpen && matchMedia(FULL_SCREEN_PANEL_QUERY).matches) {
      this.pageScrollLock = new PageScrollLock(view.root);
      this.pageScrollLock.lock();
    } else {
      this.unlockPageScroll();
    }
    if (isOpen) {
      if (this.collapseTimer !== null) clearTimeout(this.collapseTimer);
      view.root.dataset.collapsed = 'true';
      void this.ensurePanel().then(() => this.panel?.setOpen(this.isPanelOpen));
      if (!this.panel) view.panelBody.focus();
    } else {
      this.panel?.setOpen(false);
      view.launcher.focus({ preventScroll: true });
    }
    this.dispatchEvent(
      new CustomEvent(isOpen ? 'chat-open' : 'chat-close', { bubbles: true, composed: true }),
    );
  }

  /** A full-screen panel stops the page behind it from scrolling (iOS would otherwise scroll it through). */
  private unlockPageScroll(): void {
    this.pageScrollLock?.unlock();
    this.pageScrollLock = null;
  }

  private ensurePanel(): Promise<void> {
    this.panelLoad ??= loadPanelModule()
      .then((mountPanel) => this.mountPanel(mountPanel))
      .catch((error: unknown) => {
        this.panelLoad = null;
        this.showPanelLoadError(error);
      });
    return this.panelLoad;
  }

  private mountPanel(mountPanel: MountPanel): void {
    const view = this.view;
    const settings = this.settings;
    if (!view || !settings || this.panel) return;
    view.panelBody.remove();
    this.panel = mountPanel({
      mountPoint: view.panel,
      settings,
      language: this.language,
      storageKeyPrefix: this.storagePrefix,
      onRequestClose: () => this.close(),
      onLanguageChange: (language) => {
        this.language = language;
        saveLanguagePreference(this.storagePrefix, language);
        this.applyLanguage();
      },
    });
    this.panel.setOpen(this.isPanelOpen);
  }

  private showPanelLoadError(error: unknown): void {
    console.error(`<${ELEMENT_NAME}>: the chat could not be loaded.`, error);
    const body = this.view?.panelBody;
    if (!body) return;
    body.className = 'ucb-panel-error';
    body.setAttribute('role', 'alert');
    body.textContent = LAUNCHER_COPY[this.language].loadFailed;
  }

  private handlePanelKeyDown(event: KeyboardEvent): void {
    const panel = this.view?.panel;
    if (!panel || !this.isPanelOpen || !event.composedPath().includes(panel)) return;
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      this.close();
      return;
    }
    trapTabKey(event, panel);
  }

  private teardown(): void {
    if (this.collapseTimer !== null) clearTimeout(this.collapseTimer);
    this.collapseTimer = null;
    this.orbs.forEach((orb) => orb.dispose());
    this.orbs = [];
    this.unlockPageScroll();
    this.panel?.unmount();
    this.panel = null;
    this.panelLoad = null;
    this.isPanelOpen = false;
    this.view = null;
    this.settings = null;
    this.shadow.replaceChildren();
    this.shadow.adoptedStyleSheets = [];
  }

  private get storagePrefix(): string {
    return storageKeyPrefixFor(this.settings?.apiKey ?? '');
  }
}

export function defineUniversalChatBot(): void {
  if (!customElements.get(ELEMENT_NAME)) customElements.define(ELEMENT_NAME, UniversalChatBotElement);
}
