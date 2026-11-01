import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { SelectField } from '@/shared/ui/FormFields';
import { Card } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { ErrorBanner, WarningBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import type { ProviderResponse } from '../../providers/api/providerTypes';
import { useGatewaySettings, useUpdateGatewaySettings } from '../api/routingQueries';
import { buildModelSelectOptions } from '../modelOptions';

const NO_DEFAULT_MODEL_VALUE = '';

export function DefaultModelCard({ providers }: { providers: readonly ProviderResponse[] }) {
  const settingsQuery = useGatewaySettings();
  const updateSettingsMutation = useUpdateGatewaySettings();
  const { showToast } = useToast();
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);

  const savedSelection =
    settingsQuery.data?.default_model_pk === null || settingsQuery.data === undefined
      ? NO_DEFAULT_MODEL_VALUE
      : String(settingsQuery.data.default_model_pk);
  const currentSelection = pendingSelection ?? savedSelection;
  const hasUnsavedChange = pendingSelection !== null && pendingSelection !== savedSelection;

  const saveDefaultModel = () => {
    updateSettingsMutation.mutate(
      { default_model_pk: currentSelection === NO_DEFAULT_MODEL_VALUE ? null : Number(currentSelection) },
      {
        onSuccess: (settings) => {
          setPendingSelection(null);
          showToast(
            settings.default_model_name
              ? `Default model set to ${settings.default_model_name}.`
              : 'Default model cleared.',
            'success',
          );
        },
      },
    );
  };

  return (
    <Card title="Default model" description="Serves tasks without a route">
      {settingsQuery.isPending ? (
        <LoadingState />
      ) : settingsQuery.isError ? (
        <ErrorBanner message={describeError(settingsQuery.error)} onRetry={() => void settingsQuery.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          {settingsQuery.data.default_model_pk === null ? (
            <WarningBanner>
              No default model is set. Requests for unknown task names will fail, and routes without a working fallback
              have no last resort.
            </WarningBanner>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <SelectField
              label="Default model"
              isLabelVisuallyHidden
              className="w-96 max-w-full"
              value={currentSelection}
              onChange={(changeEvent) => setPendingSelection(changeEvent.target.value)}
              options={[
                { value: NO_DEFAULT_MODEL_VALUE, label: 'No default model' },
                ...buildModelSelectOptions(providers, { alwaysIncludeModelPks: [settingsQuery.data.default_model_pk] }),
              ]}
            />
            <Button
              variant="primary"
              onClick={saveDefaultModel}
              disabled={!hasUnsavedChange}
              isLoading={updateSettingsMutation.isPending}
            >
              Save
            </Button>
          </div>
          {updateSettingsMutation.isError ? (
            <ErrorBanner message={describeError(updateSettingsMutation.error)} />
          ) : null}
        </div>
      )}
    </Card>
  );
}
