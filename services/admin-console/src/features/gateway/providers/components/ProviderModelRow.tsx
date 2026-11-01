import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';
import { useToast } from '@/shared/ui/toastContext';

import { useDeleteProviderModel, useTestProviderModel, useUpdateProviderModel } from '../api/providerQueries';
import type { ProviderModelResponse } from '../api/providerTypes';
import { ConnectionTestResult } from './ConnectionTestResult';
import { ModelSettingsForm } from './ModelSettingsForm';
import { ProviderModelSummary } from './ProviderModelSummary';

/** One configured model: enable toggle, summary, and test / edit / delete actions. */
export function ProviderModelRow({ model }: { model: ProviderModelResponse }) {
  const { showToast } = useToast();
  const updateModelMutation = useUpdateProviderModel();
  const deleteModelMutation = useDeleteProviderModel();
  const testModelMutation = useTestProviderModel();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const toggleEnabled = (isEnabled: boolean) => {
    updateModelMutation.mutate(
      { modelPk: model.id, request: { is_enabled: isEnabled } },
      { onError: (error) => showToast(describeError(error), 'error') },
    );
  };

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleSwitch
          isOn={model.is_enabled}
          onChange={toggleEnabled}
          disabled={updateModelMutation.isPending}
          label={`Enable ${model.model_id}`}
          isLabelVisuallyHidden
        />
        <ProviderModelSummary model={model} />
        <div className="flex items-center gap-1.5 max-sm:basis-full max-sm:pl-12">
          <Button
            size="small"
            isLoading={testModelMutation.isPending}
            onClick={() => testModelMutation.mutate(model.id)}
          >
            Test
          </Button>
          <Button size="small" aria-expanded={isEditing} onClick={() => setIsEditing(!isEditing)}>
            {isEditing ? 'Close' : 'Edit'}
          </Button>
          <Button
            size="small"
            variant="danger"
            onClick={() => {
              deleteModelMutation.reset();
              setIsDeleteConfirmOpen(true);
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      {testModelMutation.isError ? (
        <div className="mt-3">
          <ErrorBanner title="Test failed" message={describeError(testModelMutation.error)} />
        </div>
      ) : null}
      {testModelMutation.data ? <ConnectionTestResult result={testModelMutation.data} /> : null}

      {isEditing ? (
        <ModelSettingsForm
          model={model}
          onSaved={() => {
            setIsEditing(false);
            showToast(`Model ${model.model_id} saved.`, 'success');
          }}
        />
      ) : null}

      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        title={`Delete ${model.model_id}?`}
        message={<p>Models used by a task route or as the default model cannot be deleted.</p>}
        confirmLabel="Delete model"
        isConfirming={deleteModelMutation.isPending}
        errorMessage={deleteModelMutation.isError ? describeError(deleteModelMutation.error) : null}
        onConfirm={() =>
          deleteModelMutation.mutate(model.id, {
            onSuccess: () => {
              setIsDeleteConfirmOpen(false);
              showToast(`Model ${model.model_id} deleted.`, 'success');
            },
          })
        }
        onCancel={() => setIsDeleteConfirmOpen(false)}
      />
    </li>
  );
}
