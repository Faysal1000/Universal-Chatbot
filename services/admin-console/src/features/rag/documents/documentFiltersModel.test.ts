import { describe, expect, it } from 'vitest';

import { EMPTY_DOCUMENT_FILTERS, hasActiveFilters, toDocumentListFilters } from './documentFiltersModel';

describe('toDocumentListFilters', () => {
  it('leaves out every "any" filter', () => {
    expect(toDocumentListFilters(EMPTY_DOCUMENT_FILTERS)).toEqual({});
    expect(hasActiveFilters(EMPTY_DOCUMENT_FILTERS)).toBe(false);
  });

  it('sends chosen filters and a trimmed search', () => {
    const filters = toDocumentListFilters({
      status: 'failed',
      isEnabled: 'false',
      mimeType: 'application/pdf',
      search: '  handbook ',
    });
    expect(filters).toEqual({ status: 'failed', isEnabled: 'false', mimeType: 'application/pdf', search: 'handbook' });
  });

  it('drops a search of only spaces, which rag would refuse', () => {
    expect(toDocumentListFilters({ ...EMPTY_DOCUMENT_FILTERS, search: '   ' })).toEqual({});
  });
});
