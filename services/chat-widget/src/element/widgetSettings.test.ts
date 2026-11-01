import { describe, expect, it } from 'vitest';

import { DEFAULT_GREETING_DURATION_MS, readWidgetSettings, type WidgetAttribute } from './widgetSettings';

const VALID_KEY = 'pk_0123456789abcdefghijKLMN';

function settingsFrom(attributes: Partial<Record<WidgetAttribute, string>>, pageLanguage = 'en') {
  return readWidgetSettings((name) => attributes[name] ?? null, pageLanguage);
}

describe('readWidgetSettings', () => {
  it('applies the defaults to a minimal embed', () => {
    const result = settingsFrom({ 'api-key': VALID_KEY, 'api-url': 'https://rag.example.com/' });
    expect(result).toEqual({
      ok: true,
      settings: {
        apiKey: VALID_KEY,
        apiUrl: 'https://rag.example.com',
        primaryColor: null,
        theme: 'auto',
        position: 'bottom-right',
        offsetX: '20px',
        offsetY: '20px',
        greeting: null,
        greetingDurationMs: DEFAULT_GREETING_DURATION_MS,
        language: 'en',
      },
    });
  });

  it.each([
    ['120', '120px'],
    ['6rem', '6rem'],
    [' 10VH ', '10vh'],
    ['-5px', '20px'],
    ['calc(1px)', '20px'],
  ])('reads offset %j as %j', (value, expected) => {
    const result = settingsFrom({
      'api-key': VALID_KEY,
      'api-url': 'https://rag.example.com',
      'offset-y': value,
    });
    expect(result.ok && result.settings.offsetY).toBe(expected);
  });

  it('requires the key and the API URL', () => {
    expect(settingsFrom({ 'api-url': 'https://rag.example.com' })).toEqual({
      ok: false,
      problem: 'missing_api_key',
    });
    expect(settingsFrom({ 'api-key': VALID_KEY })).toEqual({ ok: false, problem: 'missing_api_url' });
    expect(settingsFrom({ 'api-key': VALID_KEY, 'api-url': 'javascript:alert(1)' })).toEqual({
      ok: false,
      problem: 'invalid_api_url',
    });
  });

  it('refuses anything but a publishable key, so a secret key is never used from a page', () => {
    expect(
      settingsFrom({ 'api-key': 'sk_live_0123456789abcdef', 'api-url': 'https://rag.example.com' }),
    ).toEqual({ ok: false, problem: 'invalid_api_key' });
  });

  it('keeps a path prefix of the API URL (rag behind a reverse proxy)', () => {
    const result = settingsFrom({ 'api-key': VALID_KEY, 'api-url': 'https://example.com/rag/' });
    expect(result.ok && result.settings.apiUrl).toBe('https://example.com/rag');
  });

  it('falls back to defaults for invalid cosmetic attributes instead of failing', () => {
    const result = settingsFrom({
      'api-key': VALID_KEY,
      'api-url': 'https://rag.example.com',
      theme: 'sepia',
      position: 'upper-right',
      'greeting-duration-ms': '-5',
      language: 'fr',
    });
    expect(result.ok && result.settings).toMatchObject({
      theme: 'auto',
      position: 'bottom-right',
      greetingDurationMs: DEFAULT_GREETING_DURATION_MS,
      language: 'en',
    });
  });

  it('reads theme, position, greeting and its duration', () => {
    const result = settingsFrom({
      'api-key': VALID_KEY,
      'api-url': 'https://rag.example.com',
      theme: 'dark',
      position: 'Middle-Left',
      greeting: '  Ask us   anything  ',
      'greeting-duration-ms': '0',
      'primary-color': ' #0f766e ',
    });
    expect(result.ok && result.settings).toMatchObject({
      theme: 'dark',
      position: 'middle-left',
      greeting: 'Ask us anything',
      greetingDurationMs: 0,
      primaryColor: '#0f766e',
    });
  });

  it('follows the page language unless the attribute sets one', () => {
    const base = { 'api-key': VALID_KEY, 'api-url': 'https://rag.example.com' };
    expect(settingsFrom(base, 'bn-BD').ok && settingsFrom(base, 'bn-BD')).toMatchObject({
      settings: { language: 'bn' },
    });
    expect(settingsFrom({ ...base, language: 'en' }, 'bn')).toMatchObject({ settings: { language: 'en' } });
  });
});
