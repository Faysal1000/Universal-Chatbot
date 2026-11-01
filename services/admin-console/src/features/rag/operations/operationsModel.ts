import { isRecord } from '@/shared/lib/unknownRecord';
import type { PlacardState } from '@/shared/ui/StatePlacard';

import type { DeadLetter, DeadLetterRetryOutcome, QueueConsumer, QueueSummary } from './api/operationsTypes';

export function queuePlacard(queue: Pick<QueueSummary, 'isPaused' | 'counts'>): { state: PlacardState; label: string } {
  const { active, waiting, delayed } = queue.counts;
  if (queue.isPaused) return { state: 'disabled', label: 'Paused' };
  if (active > 0) return { state: 'working', label: 'Processing' };
  if (waiting > 0) return { state: 'working', label: 'Queued' };
  // Only jobs waiting for their time, such as the next run of a repeating schedule.
  if (delayed > 0) return { state: 'ready', label: 'Scheduled' };
  return { state: 'ready', label: 'Drained' };
}

const CONSUMER_LABELS: Record<QueueConsumer, string> = {
  'rag-worker': 'RAG worker',
  'document-parser': 'Document parser',
  none: 'No consumer (storage only)',
};

export function consumerLabel(consumer: QueueConsumer): string {
  return CONSUMER_LABELS[consumer];
}

/** Ingestion jobs are retried by reprocessing their document; other jobs go back to their queue. */
export function isIngestionQueue(queueName: string): boolean {
  return queueName.startsWith('ingest.') || queueName.startsWith('parse.');
}

const MAXIMUM_SUMMARY_FIELDS = 4;
const MAXIMUM_VALUE_LENGTH = 40;

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return `${String(value.length)} items`;
  if (isRecord(value)) return '{…}';
  const text = String(value);
  return text.length > MAXIMUM_VALUE_LENGTH ? `${text.slice(0, MAXIMUM_VALUE_LENGTH - 1)}…` : text;
}

export interface PayloadSummary {
  /** `key: value` pairs of the job payload, shortened. */
  fields: string[];
  hiddenFieldCount: number;
  enqueuedAt: string | null;
}

/** The job envelope (`{ meta, payload }`) reduced to the fields an operator recognises. */
export function summarisePayload(envelope: DeadLetter['payload']): PayloadSummary {
  const meta = isRecord(envelope) && isRecord(envelope.meta) ? envelope.meta : {};
  const payload = isRecord(envelope) && 'payload' in envelope ? envelope.payload : envelope;
  const entries = isRecord(payload) ? Object.entries(payload) : [['value', payload] as const];
  return {
    fields: entries.slice(0, MAXIMUM_SUMMARY_FIELDS).map(([key, value]) => `${key}: ${describeValue(value)}`),
    hiddenFieldCount: Math.max(0, entries.length - MAXIMUM_SUMMARY_FIELDS),
    enqueuedAt: typeof meta.enqueuedAt === 'string' ? meta.enqueuedAt : null,
  };
}

export function describeRetryOutcome(outcome: DeadLetterRetryOutcome): string {
  return outcome.action === 'document_reprocessed'
    ? 'Retried: the document is being processed again from the start.'
    : `Retried: job ${outcome.jobId} is back in ${outcome.queueName}.`;
}

export interface OffsetPageInfo {
  firstItemNumber: number;
  lastItemNumber: number;
  previousOffset: number | null;
  nextOffset: number | null;
}

export function offsetPageInfo(offset: number, pageSize: number, itemCount: number, total: number): OffsetPageInfo {
  return {
    firstItemNumber: itemCount === 0 ? 0 : offset + 1,
    lastItemNumber: offset + itemCount,
    previousOffset: offset > 0 ? Math.max(0, offset - pageSize) : null,
    nextOffset: offset + itemCount < total ? offset + pageSize : null,
  };
}
