import { Button } from '@/shared/ui/Button';
import { SelectField, TextField } from '@/shared/ui/FormFields';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';

import type { ProviderResponse } from '../../providers/api/providerTypes';
import { ALL_FILTER_VALUE } from './useRecentRequestFilters';
import type { RecentRequestFilterState } from './useRecentRequestFilters';

const ROW_LIMIT_OPTIONS = [
  { value: '50', label: '50 rows' },
  { value: '100', label: '100 rows' },
  { value: '250', label: '250 rows' },
  { value: '500', label: '500 rows' },
];
const KNOWN_TASK_NAMES_LIST_ID = 'known-task-names';

interface RequestFiltersBarProps {
  filterState: RecentRequestFilterState;
  onChange: (changes: Partial<RecentRequestFilterState>) => void;
  hasActiveFilters: boolean;
  onClear: () => void;
  providers: readonly ProviderResponse[];
  knownTaskNames: readonly string[];
  isAutoRefreshEnabled: boolean;
  onAutoRefreshChange: (isEnabled: boolean) => void;
}

/** Model IDs offered in the model filter, narrowed to the selected provider. */
function modelIdOptionsFor(providers: readonly ProviderResponse[], providerId: string): string[] {
  const modelIds = providers
    .filter((provider) => !providerId || provider.provider_id === providerId)
    .flatMap((provider) => provider.models.map((model) => model.model_id));
  return [...new Set(modelIds)].sort();
}

export function RequestFiltersBar({
  filterState,
  onChange,
  hasActiveFilters,
  onClear,
  providers,
  knownTaskNames,
  isAutoRefreshEnabled,
  onAutoRefreshChange,
}: RequestFiltersBarProps) {
  const modelIdOptions = modelIdOptionsFor(providers, filterState.providerId);
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <TextField
        label="Task"
        className="w-44"
        list={KNOWN_TASK_NAMES_LIST_ID}
        placeholder="Any task"
        value={filterState.taskName}
        spellCheck={false}
        onChange={(changeEvent) => onChange({ taskName: changeEvent.target.value })}
      />
      <datalist id={KNOWN_TASK_NAMES_LIST_ID}>
        {knownTaskNames.map((taskName) => (
          <option key={taskName} value={taskName} />
        ))}
      </datalist>
      <SelectField
        label="Provider"
        className="w-44"
        value={filterState.providerId}
        onChange={(changeEvent) => onChange({ providerId: changeEvent.target.value, modelId: ALL_FILTER_VALUE })}
        options={[
          { value: ALL_FILTER_VALUE, label: 'All providers' },
          ...providers.map((provider) => ({ value: provider.provider_id, label: provider.provider_id })),
        ]}
      />
      <SelectField
        label="Model"
        className="w-56"
        value={filterState.modelId}
        onChange={(changeEvent) => onChange({ modelId: changeEvent.target.value })}
        options={[
          { value: ALL_FILTER_VALUE, label: 'All models' },
          ...modelIdOptions.map((modelId) => ({ value: modelId, label: modelId })),
        ]}
      />
      <SelectField
        label="Show"
        className="w-32"
        value={filterState.rowLimit}
        onChange={(changeEvent) => onChange({ rowLimit: changeEvent.target.value })}
        options={ROW_LIMIT_OPTIONS}
      />
      <div className="flex h-9 items-center gap-4">
        <ToggleSwitch
          isOn={filterState.isErrorsOnly}
          onChange={(isErrorsOnly) => onChange({ isErrorsOnly })}
          label="Errors only"
        />
        <ToggleSwitch isOn={isAutoRefreshEnabled} onChange={onAutoRefreshChange} label="Auto-refresh (30s)" />
      </div>
      {hasActiveFilters ? (
        <Button variant="ghost" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
