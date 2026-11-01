import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { formatInteger } from '@/shared/lib/format';

import type { WidgetKey, WidgetKeyCreateRequest, WidgetKeyUpdateRequest } from './api/widgetKeyTypes';

/** Backend field names the key form can show errors for. */
export const WIDGET_KEY_FORM_FIELD_NAMES = ['name', 'allowedOrigins', 'turnsPerMinute'] as const;

const DEFAULT_TURNS_PER_MINUTE = 60;
const MAXIMUM_ALLOWED_ORIGINS = 50;
export const MAXIMUM_NAME_LENGTH = 120;
export const MAXIMUM_TURNS_PER_MINUTE = 10_000;

export interface WidgetKeyFormValues {
  name: string;
  /** One origin per line (commas also separate). */
  allowedOriginsText: string;
  turnsPerMinute: string;
}

export function emptyWidgetKeyFormValues(): WidgetKeyFormValues {
  return { name: '', allowedOriginsText: '', turnsPerMinute: String(DEFAULT_TURNS_PER_MINUTE) };
}

export function widgetKeyFormValuesOf(widgetKey: WidgetKey): WidgetKeyFormValues {
  return {
    name: widgetKey.name,
    allowedOriginsText: widgetKey.allowedOrigins.join('\n'),
    turnsPerMinute: String(widgetKey.turnsPerMinute),
  };
}

/**
 * `https://www.example.com` from what an admin pastes (`https://www.example.com/` too). A page URL or a wildcard
 * is refused, as rag refuses it, so nobody thinks a path or pattern narrows the key.
 */
export function normaliseWebsiteOrigin(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const isWebScheme = url.protocol === 'https:' || url.protocol === 'http:';
  const hasOnlyAnOrigin =
    url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === '';
  if (!isWebScheme || !hasOnlyAnOrigin || url.hostname.includes('*')) return null;
  return url.origin;
}

export interface ParsedOrigins {
  origins: string[];
  invalid: string[];
}

export function parseAllowedOrigins(text: string): ParsedOrigins {
  const entries = text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const origins = new Set<string>();
  const invalid: string[] = [];
  for (const entry of entries) {
    const origin = normaliseWebsiteOrigin(entry);
    if (origin === null) invalid.push(entry);
    else origins.add(origin);
  }
  return { origins: [...origins], invalid };
}

export function validateWidgetKeyForm(values: WidgetKeyFormValues): FieldErrorMessages {
  const fieldErrors: FieldErrorMessages = {};
  const name = values.name.trim();
  if (name.length === 0 || name.length > MAXIMUM_NAME_LENGTH) {
    fieldErrors.name = `Name the website, in 1–${MAXIMUM_NAME_LENGTH} characters.`;
  }
  const { origins, invalid } = parseAllowedOrigins(values.allowedOriginsText);
  if (invalid.length > 0) {
    fieldErrors.allowedOrigins = `Not a website origin: ${invalid.join(', ')}. Use scheme and host only, such as https://www.example.com.`;
  } else if (origins.length === 0) {
    fieldErrors.allowedOrigins = 'Add at least one website, such as https://www.example.com.';
  } else if (origins.length > MAXIMUM_ALLOWED_ORIGINS) {
    fieldErrors.allowedOrigins = `At most ${MAXIMUM_ALLOWED_ORIGINS} websites per key.`;
  }
  const turnsPerMinute = Number(values.turnsPerMinute);
  if (!Number.isInteger(turnsPerMinute) || turnsPerMinute < 1 || turnsPerMinute > MAXIMUM_TURNS_PER_MINUTE) {
    fieldErrors.turnsPerMinute = `A whole number from 1 to ${formatInteger(MAXIMUM_TURNS_PER_MINUTE)}.`;
  }
  return fieldErrors;
}

export function toWidgetKeyCreateRequest(values: WidgetKeyFormValues): WidgetKeyCreateRequest {
  return {
    name: values.name.trim(),
    allowedOrigins: parseAllowedOrigins(values.allowedOriginsText).origins,
    turnsPerMinute: Number(values.turnsPerMinute),
  };
}

export function toWidgetKeyUpdateRequest(values: WidgetKeyFormValues): WidgetKeyUpdateRequest {
  return toWidgetKeyCreateRequest(values);
}
