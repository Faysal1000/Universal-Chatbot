/** Major version of the envelope contract (`contracts/job-envelope.v1.schema.json`). */
export const JOB_ENVELOPE_SCHEMA_VERSION = 1;

/**
 * Transport metadata carried by every job, independent of the payload. It travels in the
 * job data (not in BullMQ-specific options) so the Python consumers can read it with
 * nothing but a JSON parser.
 */
export interface JobMetadata {
  readonly schemaVersion: typeof JOB_ENVELOPE_SCHEMA_VERSION;
  /** Request that caused the job, for log correlation. */
  readonly requestId?: string;
  /** ISO-8601 time the producer enqueued the job. */
  readonly enqueuedAt: string;
}

export interface JobEnvelope<Payload> {
  readonly meta: JobMetadata;
  readonly payload: Payload;
}

/** Wraps a payload with the envelope metadata. */
export function createJobEnvelope<Payload>(payload: Payload, requestId?: string): JobEnvelope<Payload> {
  return {
    meta: {
      schemaVersion: JOB_ENVELOPE_SCHEMA_VERSION,
      ...(requestId === undefined ? {} : { requestId }),
      enqueuedAt: new Date().toISOString(),
    },
    payload,
  };
}

export class InvalidJobEnvelopeError extends Error {
  constructor(reason: string) {
    super(`Invalid job envelope: ${reason}`);
    this.name = 'InvalidJobEnvelopeError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new InvalidJobEnvelopeError(`meta.${key} must be a string`);
  return value;
};

/**
 * Validates raw job data (untrusted JSON from Redis) as an envelope this code can
 * process. Unknown major versions are rejected rather than half-understood; the
 * payload itself is validated by the job's own handler.
 */
export function parseJobEnvelope(jobData: unknown): JobEnvelope<unknown> {
  if (!isRecord(jobData) || !isRecord(jobData.meta) || !('payload' in jobData)) {
    throw new InvalidJobEnvelopeError('expected an object with "meta" and "payload"');
  }
  const rawMetadata = jobData.meta;
  if (rawMetadata.schemaVersion !== JOB_ENVELOPE_SCHEMA_VERSION) {
    throw new InvalidJobEnvelopeError(
      `unsupported schemaVersion ${JSON.stringify(rawMetadata.schemaVersion)}`,
    );
  }
  const enqueuedAt = optionalString(rawMetadata, 'enqueuedAt');
  if (enqueuedAt === undefined) {
    throw new InvalidJobEnvelopeError('meta.enqueuedAt is required');
  }
  const requestId = optionalString(rawMetadata, 'requestId');
  return {
    meta: {
      schemaVersion: JOB_ENVELOPE_SCHEMA_VERSION,
      enqueuedAt,
      ...(requestId === undefined ? {} : { requestId }),
    },
    payload: jobData.payload,
  };
}
