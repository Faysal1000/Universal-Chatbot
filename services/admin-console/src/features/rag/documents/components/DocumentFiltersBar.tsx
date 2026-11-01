import { Button } from '@/shared/ui/Button';
import { SelectField, TextField } from '@/shared/ui/FormFields';

import {
  ENABLED_FILTER_OPTIONS,
  EMPTY_DOCUMENT_FILTERS,
  hasActiveFilters,
  STATUS_FILTER_OPTIONS,
  TYPE_FILTER_OPTIONS,
} from '../documentFiltersModel';
import type { DocumentFilterValues } from '../documentFiltersModel';

export interface DocumentFiltersBarProps {
  values: DocumentFilterValues;
  onChange: (values: DocumentFilterValues) => void;
}

/** Search by title or file name, and narrow by status, enablement and type. */
export function DocumentFiltersBar({ values, onChange }: DocumentFiltersBarProps) {
  const change = (changes: Partial<DocumentFilterValues>) => onChange({ ...values, ...changes });
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
      <TextField
        label="Search"
        type="search"
        placeholder="Title or file name"
        className="w-64"
        value={values.search}
        maxLength={200}
        onChange={(changeEvent) => change({ search: changeEvent.target.value })}
      />
      <SelectField
        label="Status"
        className="w-40"
        options={STATUS_FILTER_OPTIONS}
        value={values.status}
        onChange={(changeEvent) => change({ status: changeEvent.target.value as DocumentFilterValues['status'] })}
      />
      <SelectField
        label="Enabled"
        className="w-44"
        options={ENABLED_FILTER_OPTIONS}
        value={values.isEnabled}
        onChange={(changeEvent) => change({ isEnabled: changeEvent.target.value as DocumentFilterValues['isEnabled'] })}
      />
      <SelectField
        label="Type"
        className="w-32"
        options={TYPE_FILTER_OPTIONS}
        value={values.mimeType}
        onChange={(changeEvent) => change({ mimeType: changeEvent.target.value as DocumentFilterValues['mimeType'] })}
      />
      {hasActiveFilters(values) ? (
        <Button variant="ghost" onClick={() => onChange(EMPTY_DOCUMENT_FILTERS)}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
