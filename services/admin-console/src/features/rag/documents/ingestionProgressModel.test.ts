import { describe, expect, it } from 'vitest';

import type { DocumentProgressEvent, IngestionRun } from './api/documentTypes';
import { describeIngestionProgress, parseProgressEventData } from './ingestionProgressModel';
import type { ParsedProgressEvent } from './ingestionProgressModel';

function aRun(overrides: Partial<IngestionRun> = {}): IngestionRun {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'running',
    stage: 'parse',
    progressPercent: 40,
    pipelineVersion: 'v1',
    pages: { total: 10, parsed: 4, digital: 3, scanned: 1, hybrid: 0 },
    visionModelCallCount: 0,
    failure: null,
    createdAt: '2026-10-30T10:00:00.000Z',
    startedAt: '2026-10-30T10:00:01.000Z',
    finishedAt: null,
    ...overrides,
  };
}

function aProgressEvent(overrides: Partial<DocumentProgressEvent> = {}): DocumentProgressEvent {
  return { documentId: '00000000-0000-4000-8000-000000000002', status: 'parsing', run: aRun(), ...overrides };
}

function parsed(event: DocumentProgressEvent): ParsedProgressEvent {
  const parsedEvent = parseProgressEventData(JSON.stringify(event));
  if (parsedEvent === null) throw new Error('fixture did not parse');
  return parsedEvent;
}

describe('parseProgressEventData', () => {
  it('reads the payload rag sends on the progress event', () => {
    expect(parseProgressEventData(JSON.stringify(aProgressEvent()))?.run?.stage).toBe('parse');
  });

  it('accepts an event before any run exists', () => {
    expect(parseProgressEventData(JSON.stringify(aProgressEvent({ status: 'uploaded', run: null })))).not.toBeNull();
  });

  it.each(['not json', '{}', JSON.stringify({ documentId: 'x', status: 'unknown', run: null })])(
    'returns null for %s',
    (eventData) => {
      expect(parseProgressEventData(eventData)).toBeNull();
    },
  );
});

describe('describeIngestionProgress', () => {
  it('shows the stage, percentage and pages while parsing', () => {
    const progress = describeIngestionProgress(parsed(aProgressEvent()));
    expect(progress).toMatchObject({
      placardState: 'working',
      label: 'Parsing pages',
      percent: 40,
      pagesLabel: '4 of 10 pages',
      isSettled: false,
      failure: null,
    });
  });

  it('has no page count before the parser knows it', () => {
    const run = aRun({ stage: 'inspect', pages: { total: null, parsed: 0, digital: 0, scanned: 0, hybrid: 0 } });
    expect(describeIngestionProgress(parsed(aProgressEvent({ status: 'inspecting', run }))).pagesLabel).toBeNull();
  });

  it('uses the singular for one page', () => {
    const run = aRun({ pages: { total: 1, parsed: 1, digital: 1, scanned: 0, hybrid: 0 } });
    expect(describeIngestionProgress(parsed(aProgressEvent({ run }))).pagesLabel).toBe('1 of 1 page');
  });

  it('labels the document status when no run exists yet', () => {
    const progress = describeIngestionProgress(parsed(aProgressEvent({ status: 'uploaded', run: null })));
    expect(progress).toMatchObject({ label: 'Uploaded', percent: 0, isSettled: false });
  });

  it('settles at 100% when the document is ready', () => {
    const run = aRun({ status: 'succeeded', stage: 'finalize', progressPercent: 97 });
    const progress = describeIngestionProgress(parsed(aProgressEvent({ status: 'ready', run })));
    expect(progress).toMatchObject({ placardState: 'ready', label: 'Ready', percent: 100, isSettled: true });
  });

  it('settles with the run failure when the document failed', () => {
    const failure = { code: 'parser_timeout', message: 'The parser did not answer in time.' };
    const run = aRun({ status: 'failed', failure });
    const progress = describeIngestionProgress(parsed(aProgressEvent({ status: 'failed', run })));
    expect(progress).toMatchObject({ placardState: 'failed', label: 'Failed', isSettled: true, failure });
  });

  it('keeps the percentage within 0–100', () => {
    const run = aRun({ progressPercent: 140 });
    expect(describeIngestionProgress(parsed(aProgressEvent({ run }))).percent).toBe(100);
  });
});
