import { afterEach, describe, expect, it } from 'vitest';

import {
  hasUnsentMessages,
  loadLanguagePreference,
  saveLanguagePreference,
  storageKeyPrefixFor,
} from './widgetStorage';

const prefix = storageKeyPrefixFor('pk_test_key_0123456789');

describe('widget storage', () => {
  afterEach(() => localStorage.clear());

  it('namespaces every key by the publishable key', () => {
    expect(prefix).toBe('universal-chat-bot.pk_test_key_0123456789');
  });

  it('remembers the visitor language choice', () => {
    expect(loadLanguagePreference(prefix)).toBeNull();
    saveLanguagePreference(prefix, 'bn');
    expect(loadLanguagePreference(prefix)).toBe('bn');
  });

  it('notices unsent messages from an earlier visit', () => {
    expect(hasUnsentMessages(prefix)).toBe(false);
    localStorage.setItem(`${prefix}.pendingBatches.v1`, '{"draft":[{"clientMessageId":"a"}]}');
    expect(hasUnsentMessages(prefix)).toBe(true);
    localStorage.clear();
    localStorage.setItem(`${prefix}.inFlightTurns.v1`, '[{"turnId":"t"}]');
    expect(hasUnsentMessages(prefix)).toBe(true);
  });
});
