import {
  consumerLabel,
  describeRetryOutcome,
  isIngestionQueue,
  offsetPageInfo,
  queuePlacard,
  summarisePayload,
} from './operationsModel';

const EMPTY_COUNTS = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 12 };

describe('queuePlacard', () => {
  it('shows a paused queue as switched off, whatever it holds', () => {
    expect(queuePlacard({ isPaused: true, counts: { ...EMPTY_COUNTS, active: 2 } })).toEqual({
      state: 'disabled',
      label: 'Paused',
    });
  });

  it('distinguishes processing, queued and drained', () => {
    expect(queuePlacard({ isPaused: false, counts: { ...EMPTY_COUNTS, active: 1 } }).label).toBe('Processing');
    expect(queuePlacard({ isPaused: false, counts: { ...EMPTY_COUNTS, waiting: 2, delayed: 3 } }).label).toBe('Queued');
    expect(queuePlacard({ isPaused: false, counts: { ...EMPTY_COUNTS, delayed: 1 } }).label).toBe('Scheduled');
    expect(queuePlacard({ isPaused: false, counts: EMPTY_COUNTS }).label).toBe('Drained');
  });
});

describe('consumerLabel and isIngestionQueue', () => {
  it('names consumers and recognises ingestion queues', () => {
    expect(consumerLabel('document-parser')).toBe('Document parser');
    expect(isIngestionQueue('parse.pages')).toBe(true);
    expect(isIngestionQueue('ingest.chunk')).toBe(true);
    expect(isIngestionQueue('eval.run')).toBe(false);
  });
});

describe('summarisePayload', () => {
  it('reads the payload and enqueue time out of a job envelope', () => {
    const summary = summarisePayload({
      meta: { schemaVersion: 1, enqueuedAt: '2026-10-30T09:00:00Z' },
      payload: { documentId: 'd-1', pageNumbers: [1, 2, 3] },
    });
    expect(summary).toEqual({
      fields: ['documentId: d-1', 'pageNumbers: 3 items'],
      hiddenFieldCount: 0,
      enqueuedAt: '2026-10-30T09:00:00Z',
    });
  });

  it('shortens long values and counts the fields it leaves out', () => {
    const summary = summarisePayload({
      payload: { a: 'x'.repeat(60), b: 1, c: 2, d: 3, e: 4 },
    });
    expect(summary.fields[0]).toHaveLength('a: '.length + 40);
    expect(summary.hiddenFieldCount).toBe(1);
  });

  it('copes with a payload that is not an envelope', () => {
    expect(summarisePayload('raw').fields).toEqual(['value: raw']);
  });
});

describe('describeRetryOutcome', () => {
  it('explains both retry paths', () => {
    expect(describeRetryOutcome({ action: 'document_reprocessed', documentId: 'd', ingestionRunId: 'r' })).toContain(
      'processed again',
    );
    expect(describeRetryOutcome({ action: 'job_retried', queueName: 'eval.run', jobId: '42' })).toBe(
      'Retried: job 42 is back in eval.run.',
    );
  });
});

describe('offsetPageInfo', () => {
  it('describes a middle page', () => {
    expect(offsetPageInfo(25, 25, 25, 80)).toEqual({
      firstItemNumber: 26,
      lastItemNumber: 50,
      previousOffset: 0,
      nextOffset: 50,
    });
  });

  it('has no next page at the end', () => {
    expect(offsetPageInfo(75, 25, 5, 80).nextOffset).toBeNull();
    expect(offsetPageInfo(0, 25, 0, 0).firstItemNumber).toBe(0);
  });
});
