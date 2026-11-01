import { useState } from 'react';

import { useDebouncedValue } from '@/features/rag/shared/useDebouncedValue';

import type { RecentRequestFilters } from '../api/analyticsApi';

/** Select value meaning "no filter". */
export const ALL_FILTER_VALUE = '';
const DEFAULT_ROW_LIMIT = '50';
const TASK_FILTER_DEBOUNCE_MILLISECONDS = 300;

/** Editable state of the request log filters. */
export interface RecentRequestFilterState {
  isErrorsOnly: boolean;
  taskName: string;
  providerId: string;
  modelId: string;
  rowLimit: string;
}

const INITIAL_FILTER_STATE: RecentRequestFilterState = {
  isErrorsOnly: false,
  taskName: '',
  providerId: ALL_FILTER_VALUE,
  modelId: ALL_FILTER_VALUE,
  rowLimit: DEFAULT_ROW_LIMIT,
};

/**
 * Filter state for the request log plus the API query it produces. Typing in the task
 * box is debounced so every keystroke does not start a request.
 */
export function useRecentRequestFilters() {
  const [filterState, setFilterState] = useState<RecentRequestFilterState>(INITIAL_FILTER_STATE);
  const deferredTaskName = useDebouncedValue(filterState.taskName.trim(), TASK_FILTER_DEBOUNCE_MILLISECONDS);

  const updateFilters = (changes: Partial<RecentRequestFilterState>) =>
    setFilterState((current) => ({ ...current, ...changes }));

  const hasActiveFilters =
    filterState.isErrorsOnly ||
    filterState.taskName !== '' ||
    filterState.providerId !== ALL_FILTER_VALUE ||
    filterState.modelId !== ALL_FILTER_VALUE;

  const clearFilters = () => setFilterState((current) => ({ ...INITIAL_FILTER_STATE, rowLimit: current.rowLimit }));

  const apiFilters: RecentRequestFilters = {
    limit: Number(filterState.rowLimit),
    errors_only: filterState.isErrorsOnly || undefined,
    task_name: deferredTaskName || undefined,
    provider_id: filterState.providerId || undefined,
    model_id: filterState.modelId || undefined,
  };

  return { filterState, updateFilters, hasActiveFilters, clearFilters, apiFilters };
}
