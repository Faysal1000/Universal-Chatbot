import { describe, expect, it } from 'vitest';

import { DOCUMENT_STATUSES } from './api/documentTypes';
import type { DocumentStatus } from './api/documentTypes';
import {
  documentDisplayName,
  documentStatusPlacard,
  hasWorkingDocuments,
  ingestionRunPlacard,
  isDocumentIngesting,
  mimeTypeLabel,
} from './documentStatusModel';

describe('documentStatusPlacard', () => {
  it.each<DocumentStatus>(['uploaded', 'inspecting', 'parsing', 'chunking', 'indexing', 'deleting'])(
    'shows %s as working',
    (status) => {
      expect(documentStatusPlacard(status).state).toBe('working');
    },
  );

  it('shows ready as ready and failed as failed', () => {
    expect(documentStatusPlacard('ready')).toEqual({ state: 'ready', label: 'Ready' });
    expect(documentStatusPlacard('failed')).toEqual({ state: 'failed', label: 'Failed' });
  });

  it('gives every status a text label', () => {
    for (const status of DOCUMENT_STATUSES) expect(documentStatusPlacard(status).label).not.toBe('');
  });
});

describe('isDocumentIngesting', () => {
  it('is true from upload through indexing only', () => {
    const ingestingStatuses = DOCUMENT_STATUSES.filter(isDocumentIngesting);
    expect(ingestingStatuses).toEqual(['uploaded', 'inspecting', 'parsing', 'chunking', 'indexing']);
  });
});

describe('hasWorkingDocuments', () => {
  it('is true while any document has not settled', () => {
    expect(hasWorkingDocuments([{ status: 'ready' }, { status: 'deleting' }])).toBe(true);
    expect(hasWorkingDocuments([{ status: 'ready' }, { status: 'failed' }])).toBe(false);
  });
});

describe('ingestionRunPlacard', () => {
  it('marks cancelled runs as switched off, not failed', () => {
    expect(ingestionRunPlacard('cancelled').state).toBe('disabled');
    expect(ingestionRunPlacard('failed').state).toBe('failed');
  });
});

describe('labels', () => {
  it('names supported types and passes unknown ones through', () => {
    expect(mimeTypeLabel('application/pdf')).toBe('PDF');
    expect(mimeTypeLabel('text/plain')).toBe('text/plain');
  });

  it('prefers the title over the file name', () => {
    expect(documentDisplayName({ title: 'Handbook', originalFilename: 'hb.pdf' })).toBe('Handbook');
    expect(documentDisplayName({ title: null, originalFilename: 'hb.pdf' })).toBe('hb.pdf');
  });
});
