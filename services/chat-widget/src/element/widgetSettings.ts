import { parseWidgetPosition, type WidgetPosition } from './widgetPosition';

export type WidgetLanguage = 'en' | 'bn';
export type WidgetTheme = 'light' | 'dark' | 'auto';

/** Everything the element reads from its attributes, validated and with defaults applied. */
export interface WidgetSettings {
  apiKey: string;
  apiUrl: string;
  primaryColor: string | null;
  theme: WidgetTheme;
  position: WidgetPosition;
  /** Gap between the launcher and the left/right screen edge, as a CSS length. */
  offsetX: string;
  /** Gap between the launcher and the top/bottom screen edge, as a CSS length. */
  offsetY: string;
  /** Label of the launcher pill before it collapses; null shows the localised "Chat". */
  greeting: string | null;
  /** How long the label shows before collapsing to the icon; 0 starts collapsed. */
  greetingDurationMs: number;
  language: WidgetLanguage;
}

export const WIDGET_ATTRIBUTES = [
  'api-key',
  'api-url',
  'primary-color',
  'theme',
  'position',
  'offset-x',
  'offset-y',
  'greeting',
  'greeting-duration-ms',
  'language',
] as const;
export type WidgetAttribute = (typeof WIDGET_ATTRIBUTES)[number];

export const DEFAULT_GREETING_DURATION_MS = 8_000;
const MAX_GREETING_LENGTH = 80;
const PUBLISHABLE_KEY_PATTERN = /^pk_[A-Za-z0-9_-]{16,128}$/;
export const DEFAULT_OFFSET = '20px';
/** A plain number (pixels) or a number with a length unit. */
const OFFSET_PATTERN = /^(\d+(?:\.\d+)?)(px|rem|em|vh|vw|dvh|%)?$/;

export type SettingsProblem = 'missing_api_key' | 'invalid_api_key' | 'missing_api_url' | 'invalid_api_url';

export type SettingsResult = { ok: true; settings: WidgetSettings } | { ok: false; problem: SettingsProblem };

/**
 * Turns the element's attributes into settings. The key and URL are required; every other attribute degrades
 * to its default, because a typo in a cosmetic attribute must never take the chat off a live website.
 */
export function readWidgetSettings(
  attribute: (name: WidgetAttribute) => string | null,
  pageLanguage: string,
): SettingsResult {
  const apiKey = attribute('api-key')?.trim() ?? '';
  if (!apiKey) return { ok: false, problem: 'missing_api_key' };
  if (!PUBLISHABLE_KEY_PATTERN.test(apiKey)) return { ok: false, problem: 'invalid_api_key' };
  const rawApiUrl = attribute('api-url')?.trim() ?? '';
  if (!rawApiUrl) return { ok: false, problem: 'missing_api_url' };
  const apiUrl = parseApiUrl(rawApiUrl);
  if (apiUrl === null) return { ok: false, problem: 'invalid_api_url' };

  const primaryColor = attribute('primary-color')?.trim() ?? '';
  return {
    ok: true,
    settings: {
      apiKey,
      apiUrl,
      primaryColor: primaryColor === '' ? null : primaryColor,
      theme: parseTheme(attribute('theme')),
      position: parseWidgetPosition(attribute('position')),
      offsetX: parseOffset(attribute('offset-x')),
      offsetY: parseOffset(attribute('offset-y')),
      greeting: parseGreeting(attribute('greeting')),
      greetingDurationMs: parseDuration(attribute('greeting-duration-ms')),
      language: parseLanguage(attribute('language'), pageLanguage),
    },
  };
}

/** The API origin plus an optional path prefix, without a trailing slash; only http(s). */
function parseApiUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function parseTheme(value: string | null): WidgetTheme {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/** `100` and `100px` are pixels; `6rem`, `10vh` and the like pass through. Anything else is the default. */
function parseOffset(value: string | null): string {
  const match = OFFSET_PATTERN.exec(value?.trim().toLowerCase() ?? '');
  if (!match) return DEFAULT_OFFSET;
  const [, amount, unit = 'px'] = match;
  return `${amount}${unit}`;
}

function parseGreeting(value: string | null): string | null {
  const trimmed = value?.trim().replace(/\s+/g, ' ') ?? '';
  return trimmed ? trimmed.slice(0, MAX_GREETING_LENGTH) : null;
}

function parseDuration(value: string | null): number {
  if (value === null || value.trim() === '') return DEFAULT_GREETING_DURATION_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : DEFAULT_GREETING_DURATION_MS;
}

/** The attribute wins; otherwise the page's own language (`<html lang="bn">`) decides. */
function parseLanguage(value: string | null, pageLanguage: string): WidgetLanguage {
  const requested = (value ?? pageLanguage).trim().toLowerCase();
  return requested.startsWith('bn') ? 'bn' : 'en';
}
