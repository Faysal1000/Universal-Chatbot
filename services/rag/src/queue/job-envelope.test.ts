import { describe, expect, it } from 'vitest';

import {
  createJobEnvelope,
  InvalidJobEnvelopeError,
  JOB_ENVELOPE_SCHEMA_VERSION,
  parseJobEnvelope,
} from './job-envelope.js';

describe('job envelope', () => {
  describe('createJobEnvelope', () => {
    it('wraps the payload with the schema version and request ID', () => {
      const envelope = createJobEnvelope({ documentId: 'doc-1' }, 'request-1');

      expect(envelope.meta.schemaVersion).toBe(JOB_ENVELOPE_SCHEMA_VERSION);
      expect(envelope.meta.requestId).toBe('request-1');
      expect(envelope.payload).toEqual({ documentId: 'doc-1' });
    });

    it('omits the request ID when none is given', () => {
      const envelope = createJobEnvelope({ documentId: 'doc-1' });

      expect(envelope.meta).not.toHaveProperty('requestId');
      expect(Number.isNaN(Date.parse(envelope.meta.enqueuedAt))).toBe(false);
    });
  });

  describe('parseJobEnvelope', () => {
    it('accepts a valid envelope and survives a JSON round trip (Redis transport)', () => {
      const original = createJobEnvelope({ pages: [1, 2, 3] }, 'request-2');

      expect(parseJobEnvelope(JSON.parse(JSON.stringify(original)))).toEqual(original);
    });

    it.each([
      ['not an object', 'payload'],
      ['missing meta', { payload: {} }],
      ['missing payload', { meta: { schemaVersion: 1, enqueuedAt: '2026-01-01T00:00:00Z' } }],
      [
        'a future major version',
        { meta: { schemaVersion: 2, enqueuedAt: '2026-01-01T00:00:00Z' }, payload: {} },
      ],
      ['no enqueuedAt', { meta: { schemaVersion: 1 }, payload: {} }],
      ['a non-string requestId', { meta: { schemaVersion: 1, enqueuedAt: 'x', requestId: 7 }, payload: {} }],
    ])('rejects %s', (_description, jobData) => {
      expect(() => parseJobEnvelope(jobData)).toThrow(InvalidJobEnvelopeError);
    });
  });
});
