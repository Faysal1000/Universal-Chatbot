import { describe, expect, it, vi } from 'vitest';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { WidgetAccessPolicy } from './widget-access.policy.js';
import type { WidgetKeyRecord, WidgetKeysRepository } from './widget-keys.repository.js';

const SHOP_KEY: WidgetKeyRecord = {
  id: '6a1d1c3e-0000-4000-8000-000000000001',
  name: 'Shop',
  publishableKey: 'pk_shop_aaaaaaaaaaaaaaaaaaaaaaaa',
  allowedOrigins: ['https://shop.example'],
  turnsPerMinute: 30,
  createdByAdminUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  revokedAt: null,
};

function createPolicy(activeKeys: WidgetKeyRecord[] = [SHOP_KEY]) {
  const listActive = vi.fn().mockResolvedValue(activeKeys);
  const repository = { listActive } as unknown as WidgetKeysRepository;
  const configuration = {
    publicAccess: { corsAllowedOrigins: ['https://chat.example'] },
  } as unknown as ServiceConfiguration;
  return { policy: new WidgetAccessPolicy(repository, configuration), listActive };
}

function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'no error',
    (error: unknown) => (error as { code: string }).code,
  );
}

describe('WidgetAccessPolicy', () => {
  it('allows CORS for first-party origins and origins of active keys only', async () => {
    const { policy } = createPolicy();
    expect(await policy.isCorsOriginAllowed('https://chat.example')).toBe(true);
    expect(await policy.isCorsOriginAllowed('https://shop.example')).toBe(true);
    expect(await policy.isCorsOriginAllowed('https://evil.example')).toBe(false);
  });

  it('grants a key on one of its origins', async () => {
    const { policy } = createPolicy();
    const grant = await policy.authorizeRequest({
      origin: 'https://shop.example',
      'x-widget-key': SHOP_KEY.publishableKey,
    });
    expect(grant).toEqual({ widgetKeyId: SHOP_KEY.id, turnsPerMinute: 30 });
  });

  it('refuses a key on another website, or without an origin', async () => {
    const { policy } = createPolicy();
    const headers = { 'x-widget-key': SHOP_KEY.publishableKey };
    expect(await errorCodeOf(policy.authorizeRequest({ ...headers, origin: 'https://evil.example' }))).toBe(
      'widget_origin_not_allowed',
    );
    expect(await errorCodeOf(policy.authorizeRequest(headers))).toBe('widget_origin_not_allowed');
  });

  it('refuses unknown or revoked keys', async () => {
    const { policy } = createPolicy([]);
    const request = policy.authorizeRequest({
      origin: 'https://shop.example',
      'x-widget-key': SHOP_KEY.publishableKey,
    });
    expect(await errorCodeOf(request)).toBe('widget_key_invalid');
  });

  it('lets the first-party app in without a key, but not a widget site', async () => {
    const { policy } = createPolicy();
    expect(await policy.authorizeRequest({ origin: 'https://chat.example' })).toBeNull();
    expect(await policy.authorizeRequest({})).toBeNull();
    expect(await errorCodeOf(policy.authorizeRequest({ origin: 'https://shop.example' }))).toBe(
      'widget_key_required',
    );
  });

  it('ends sessions of a revoked key', async () => {
    const { policy } = createPolicy([]);
    expect(await errorCodeOf(policy.authorizeSession(SHOP_KEY.id, { origin: 'https://shop.example' }))).toBe(
      'widget_key_revoked',
    );
  });

  it('caches active keys until invalidated', async () => {
    const { policy, listActive } = createPolicy();
    await policy.isCorsOriginAllowed('https://shop.example');
    await policy.isCorsOriginAllowed('https://shop.example');
    expect(listActive).toHaveBeenCalledTimes(1);
    policy.invalidate();
    await policy.isCorsOriginAllowed('https://shop.example');
    expect(listActive).toHaveBeenCalledTimes(2);
  });
});
