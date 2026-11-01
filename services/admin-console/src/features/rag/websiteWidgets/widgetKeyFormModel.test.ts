import { describe, expect, it } from 'vitest';

import {
  emptyWidgetKeyFormValues,
  normaliseWebsiteOrigin,
  parseAllowedOrigins,
  toWidgetKeyCreateRequest,
  validateWidgetKeyForm,
} from './widgetKeyFormModel';

describe('normaliseWebsiteOrigin', () => {
  it.each([
    ['https://www.example.com', 'https://www.example.com'],
    ['https://www.example.com/', 'https://www.example.com'],
    ['HTTPS://Shop.Example.com', 'https://shop.example.com'],
    ['http://localhost:5391', 'http://localhost:5391'],
  ])('accepts %s', (input, origin) => {
    expect(normaliseWebsiteOrigin(input)).toBe(origin);
  });

  it.each(['example.com', 'https://example.com/shop', 'https://*.example.com', 'ftp://example.com', ''])(
    'refuses %s',
    (input) => {
      expect(normaliseWebsiteOrigin(input)).toBeNull();
    },
  );
});

describe('parseAllowedOrigins', () => {
  it('splits on lines and commas, drops duplicates and reports what it cannot read', () => {
    expect(parseAllowedOrigins('https://a.example\nhttps://a.example/, https://b.example\n\nb.example')).toEqual({
      origins: ['https://a.example', 'https://b.example'],
      invalid: ['b.example'],
    });
  });
});

describe('validateWidgetKeyForm', () => {
  const valid = { name: 'Shop', allowedOriginsText: 'https://shop.example', turnsPerMinute: '60' };

  it('accepts a complete form', () => {
    expect(validateWidgetKeyForm(valid)).toEqual({});
  });

  it('flags every problem of an empty form', () => {
    expect(Object.keys(validateWidgetKeyForm({ ...emptyWidgetKeyFormValues(), turnsPerMinute: '0' }))).toEqual([
      'name',
      'allowedOrigins',
      'turnsPerMinute',
    ]);
  });

  it('names the origins it cannot read', () => {
    expect(
      validateWidgetKeyForm({ ...valid, allowedOriginsText: 'https://shop.example/path' }).allowedOrigins,
    ).toContain('https://shop.example/path');
  });

  it('builds the request from the form', () => {
    expect(toWidgetKeyCreateRequest({ ...valid, name: '  Shop ' })).toEqual({
      name: 'Shop',
      allowedOrigins: ['https://shop.example'],
      turnsPerMinute: 60,
    });
  });
});
