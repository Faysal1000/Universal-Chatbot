import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner, Tag } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { providerQueryKeys } from '../api/providerQueryKeys';
import type { DiscoveredModelResponse } from '../api/providerTypes';
import { createProviderModel } from '../api/providersApi';

export interface DiscoverModelsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  isLoading: boolean;
  errorMessage: string | null;
  discoveredModels: readonly DiscoveredModelResponse[];
  onRetry: () => void;
}

/** Lists the models offered by the provider and adds the ticked ones. */
export function DiscoverModelsDialog({
  isOpen,
  onClose,
  providerId,
  isLoading,
  errorMessage,
  discoveredModels,
  onRetry,
}: DiscoverModelsDialogProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedModelIds, setSelectedModelIds] = useState<ReadonlySet<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addErrorMessages, setAddErrorMessages] = useState<string[]>([]);

  const normalizedSearchText = searchText.trim().toLowerCase();
  const visibleModels = discoveredModels.filter(
    (model) =>
      !normalizedSearchText ||
      model.model_id.toLowerCase().includes(normalizedSearchText) ||
      (model.display_name ?? '').toLowerCase().includes(normalizedSearchText),
  );
  const selectableVisibleModelIds = visibleModels
    .filter((model) => !model.already_added)
    .map((model) => model.model_id);

  const toggleModel = (modelId: string) => {
    setSelectedModelIds((currentSelection) => {
      const nextSelection = new Set(currentSelection);
      if (nextSelection.has(modelId)) nextSelection.delete(modelId);
      else nextSelection.add(modelId);
      return nextSelection;
    });
  };

  const closeDialog = () => {
    setSelectedModelIds(new Set());
    setSearchText('');
    setAddErrorMessages([]);
    onClose();
  };

  const addSelectedModels = async () => {
    setIsAdding(true);
    setAddErrorMessages([]);
    const modelsToAdd = discoveredModels.filter((model) => selectedModelIds.has(model.model_id));
    const results = await Promise.allSettled(
      modelsToAdd.map((model) =>
        createProviderModel(providerId, { model_id: model.model_id, display_name: model.display_name }),
      ),
    );
    await queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
    setIsAdding(false);
    const failedModels = modelsToAdd.filter((_model, modelIndex) => results[modelIndex]?.status === 'rejected');
    const failures = results.flatMap((result, resultIndex) =>
      result.status === 'rejected'
        ? [`${modelsToAdd[resultIndex]?.model_id ?? '?'}: ${describeError(result.reason)}`]
        : [],
    );
    const addedCount = results.length - failures.length;
    if (addedCount > 0) showToast(`Added ${addedCount} model${addedCount === 1 ? '' : 's'}.`, 'success');
    if (failures.length > 0) {
      setSelectedModelIds(new Set(failedModels.map((model) => model.model_id)));
      setAddErrorMessages(failures);
    } else closeDialog();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={closeDialog}
      width="large"
      title="Available models"
      description="Tick the models to add."
      footer={
        <>
          <Button onClick={closeDialog}>Close</Button>
          <Button
            variant="primary"
            isLoading={isAdding}
            disabled={selectedModelIds.size === 0}
            onClick={() => void addSelectedModels()}
          >
            Add {selectedModelIds.size > 0 ? selectedModelIds.size : ''} selected
          </Button>
        </>
      }
    >
      {isLoading ? (
        <LoadingState label="Asking the provider for its models…" />
      ) : errorMessage ? (
        <ErrorBanner title="Could not fetch models" message={errorMessage} onRetry={onRetry} />
      ) : discoveredModels.length === 0 ? (
        <EmptyState title="The provider returned no models" description="Add them by ID instead." />
      ) : (
        <div className="flex flex-col gap-3">
          {addErrorMessages.length > 0 ? (
            <ErrorBanner title="Some models could not be added" message={addErrorMessages.join('; ')} />
          ) : null}
          <div className="flex items-center gap-2">
            <input
              type="search"
              aria-label="Filter models"
              placeholder="Filter models"
              value={searchText}
              onChange={(changeEvent) => setSearchText(changeEvent.target.value)}
              className="h-9 flex-1 rounded border border-border bg-surface-input px-3 text-sm text-primary placeholder:text-muted"
            />
            <Button
              size="small"
              disabled={selectableVisibleModelIds.length === 0}
              onClick={() => setSelectedModelIds(new Set([...selectedModelIds, ...selectableVisibleModelIds]))}
            >
              Select all
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={selectedModelIds.size === 0}
              onClick={() => setSelectedModelIds(new Set())}
            >
              Clear
            </Button>
          </div>
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded border border-border">
            {visibleModels.map((model) => (
              <li key={model.model_id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-hover has-disabled:cursor-default">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={model.already_added || selectedModelIds.has(model.model_id)}
                    disabled={model.already_added}
                    onChange={() => toggleModel(model.model_id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm text-primary">{model.model_id}</span>
                    {model.display_name && model.display_name !== model.model_id ? (
                      <span className="block truncate text-xs text-muted">{model.display_name}</span>
                    ) : null}
                  </span>
                  {model.already_added ? <Tag>Added</Tag> : null}
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            {discoveredModels.length} models · {discoveredModels.filter((model) => model.already_added).length} already
            added
          </p>
        </div>
      )}
    </Dialog>
  );
}
