import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/FormFields';
import { Card } from '@/shared/ui/Layout';
import { EmptyState } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useCreateProviderModel, useDiscoverProviderModels } from '../api/providerQueries';
import type { ProviderResponse } from '../api/providerTypes';
import { DiscoverModelsDialog } from './DiscoverModelsDialog';
import { ProviderModelRow } from './ProviderModelRow';

/** The provider's models: discovery, manual add, and per-model settings. */
export function ProviderModelsSection({ provider }: { provider: ProviderResponse }) {
  const { showToast } = useToast();
  const discoverModelsMutation = useDiscoverProviderModels();
  const createModelMutation = useCreateProviderModel();
  const [isDiscoverDialogOpen, setIsDiscoverDialogOpen] = useState(false);
  const [manualModelId, setManualModelId] = useState('');

  const fetchAvailableModels = () => {
    setIsDiscoverDialogOpen(true);
    discoverModelsMutation.mutate(provider.provider_id);
  };

  const addManualModel = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const modelId = manualModelId.trim();
    if (!modelId) return;
    createModelMutation.mutate(
      { providerId: provider.provider_id, request: { model_id: modelId } },
      {
        onSuccess: () => {
          setManualModelId('');
          showToast(`Model ${modelId} added.`, 'success');
        },
      },
    );
  };

  return (
    <Card
      title="Models"
      actions={
        <Button onClick={fetchAvailableModels} isLoading={discoverModelsMutation.isPending}>
          Fetch available models
        </Button>
      }
      bodyClassName="p-0"
    >
      <form onSubmit={addManualModel} className="flex flex-wrap items-start gap-2 border-b border-border p-4">
        <TextField
          label="Model ID"
          isLabelVisuallyHidden
          className="w-80"
          placeholder="Add a model by ID, e.g. deepseek-chat"
          value={manualModelId}
          maxLength={255}
          spellCheck={false}
          onChange={(changeEvent) => {
            setManualModelId(changeEvent.target.value);
            if (createModelMutation.isError) createModelMutation.reset();
          }}
          errorMessage={createModelMutation.isError ? describeError(createModelMutation.error) : undefined}
        />
        <Button type="submit" isLoading={createModelMutation.isPending} disabled={!manualModelId.trim()}>
          Add model
        </Button>
      </form>

      {provider.models.length === 0 ? (
        <EmptyState
          title="No models will be shown in the selector."
          description="Fetch available models, or add one by ID."
        />
      ) : (
        <ul className="divide-y divide-border">
          {provider.models.map((model) => (
            <ProviderModelRow key={model.id} model={model} />
          ))}
        </ul>
      )}

      <DiscoverModelsDialog
        isOpen={isDiscoverDialogOpen}
        onClose={() => setIsDiscoverDialogOpen(false)}
        providerId={provider.provider_id}
        isLoading={discoverModelsMutation.isPending}
        errorMessage={discoverModelsMutation.isError ? describeError(discoverModelsMutation.error) : null}
        discoveredModels={discoverModelsMutation.data ?? []}
        onRetry={() => discoverModelsMutation.mutate(provider.provider_id)}
      />
    </Card>
  );
}
