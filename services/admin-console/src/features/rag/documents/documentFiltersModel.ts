/** The documents list's filter controls and the query rag receives from them. */
import type { SelectOption } from '@/shared/ui/FormFields';

import type { DocumentListFilters } from './api/documentQueries';
import { DOCUMENT_STATUSES, SUPPORTED_MIME_TYPES } from './api/documentTypes';
import type { DocumentStatus, SupportedMimeType } from './api/documentTypes';
import { documentStatusPlacard, mimeTypeLabel } from './documentStatusModel';

const ANY_VALUE = '';

/** Raw values of the filter controls; the empty string means "any". */
export interface DocumentFilterValues {
  status: DocumentStatus | typeof ANY_VALUE;
  isEnabled: 'true' | 'false' | typeof ANY_VALUE;
  mimeType: SupportedMimeType | typeof ANY_VALUE;
  search: string;
}

export const EMPTY_DOCUMENT_FILTERS: DocumentFilterValues = { status: '', isEnabled: '', mimeType: '', search: '' };

export const STATUS_FILTER_OPTIONS: readonly SelectOption[] = [
  { value: ANY_VALUE, label: 'Any status' },
  ...DOCUMENT_STATUSES.map((status) => ({ value: status, label: documentStatusPlacard(status).label })),
];

export const ENABLED_FILTER_OPTIONS: readonly SelectOption[] = [
  { value: ANY_VALUE, label: 'Any' },
  { value: 'true', label: 'Enabled' },
  { value: 'false', label: 'Disabled' },
];

export const TYPE_FILTER_OPTIONS: readonly SelectOption[] = [
  { value: ANY_VALUE, label: 'Any type' },
  ...SUPPORTED_MIME_TYPES.map((mimeType) => ({ value: mimeType, label: mimeTypeLabel(mimeType) })),
];

/** rag rejects an empty `search`; "any" filters are left out of the query. */
export function toDocumentListFilters(values: DocumentFilterValues): DocumentListFilters {
  const trimmedSearch = values.search.trim();
  return {
    ...(values.status === ANY_VALUE ? {} : { status: values.status }),
    ...(values.isEnabled === ANY_VALUE ? {} : { isEnabled: values.isEnabled }),
    ...(values.mimeType === ANY_VALUE ? {} : { mimeType: values.mimeType }),
    ...(trimmedSearch === '' ? {} : { search: trimmedSearch }),
  };
}

export function hasActiveFilters(values: DocumentFilterValues): boolean {
  return Object.keys(toDocumentListFilters(values)).length > 0;
}
