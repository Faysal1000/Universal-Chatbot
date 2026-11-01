import {
  clientBlockState,
  describeBlockTarget,
  emptyClientBlockFormValues,
  looksLikeIpAddress,
  resolveExpiresAt,
  toClientBlockCreateRequest,
  validateClientBlockForm,
} from './clientBlockFormModel';
import type { ClientBlockFormValues } from './clientBlockFormModel';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const VISITOR_SESSION_ID = '0b6c2f4e-1d2a-4c3b-9e8f-7a6b5c4d3e2f';

function formValues(overrides: Partial<ClientBlockFormValues> = {}): ClientBlockFormValues {
  return { ...emptyClientBlockFormValues(), ipAddress: '203.0.113.7', reason: 'Spam', ...overrides };
}

describe('emptyClientBlockFormValues', () => {
  it('targets the visitor session when one is given', () => {
    expect(emptyClientBlockFormValues(VISITOR_SESSION_ID)).toMatchObject({
      targetKind: 'visitorSession',
      visitorSessionId: VISITOR_SESSION_ID,
    });
  });
});

describe('looksLikeIpAddress', () => {
  it.each(['203.0.113.7', '2001:db8::1', '::ffff:192.0.2.1'])('accepts %s', (address) => {
    expect(looksLikeIpAddress(address)).toBe(true);
  });

  it.each(['256.1.1.1', 'example.com', '10.0.0'])('rejects %s', (address) => {
    expect(looksLikeIpAddress(address)).toBe(false);
  });
});

describe('resolveExpiresAt', () => {
  it('is null for an indefinite block', () => {
    expect(resolveExpiresAt(formValues({ durationChoice: 'never' }), NOW)).toBeNull();
  });

  it('adds the chosen duration to now', () => {
    expect(resolveExpiresAt(formValues({ durationChoice: '24h' }), NOW)).toBe('2026-10-31T12:00:00.000Z');
  });

  it('is undefined for an empty custom time', () => {
    expect(resolveExpiresAt(formValues({ durationChoice: 'custom', customExpiresAt: '' }), NOW)).toBeUndefined();
  });
});

describe('validateClientBlockForm', () => {
  it('accepts a complete address block', () => {
    expect(validateClientBlockForm(formValues(), NOW)).toEqual({});
  });

  it('requires a reason and a full session id', () => {
    const fieldErrors = validateClientBlockForm(
      formValues({ targetKind: 'visitorSession', visitorSessionId: '0b6c', reason: ' ' }),
      NOW,
    );
    expect(Object.keys(fieldErrors).sort()).toEqual(['reason', 'visitorSessionId']);
  });

  it('rejects a custom end in the past', () => {
    const fieldErrors = validateClientBlockForm(
      formValues({ durationChoice: 'custom', customExpiresAt: '2020-01-01T00:00' }),
      NOW,
    );
    expect(fieldErrors.expiresAt).toBe('Choose a time in the future.');
  });
});

describe('toClientBlockCreateRequest', () => {
  it('sends only the chosen target', () => {
    const request = toClientBlockCreateRequest(
      formValues({ targetKind: 'visitorSession', visitorSessionId: VISITOR_SESSION_ID, durationChoice: 'never' }),
      NOW,
    );
    expect(request).toEqual({ visitorSessionId: VISITOR_SESSION_ID, reason: 'Spam', expiresAt: null });
  });
});

describe('block display', () => {
  it('describes what a session block matches', () => {
    expect(describeBlockTarget({ ipHash: 'a', fingerprintHash: 'b' })).toBe('Network address and device');
    expect(describeBlockTarget({ ipHash: 'a', fingerprintHash: null })).toBe('Network address');
  });

  it('shows expired blocks as stopped', () => {
    expect(clientBlockState({ expiresAt: '2026-10-29T00:00:00Z' }, NOW)).toEqual({
      state: 'stopped',
      label: 'Expired',
    });
    expect(clientBlockState({ expiresAt: null }, NOW).state).toBe('ready');
  });
});
