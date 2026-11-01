import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { splitApiError } from '@/shared/lib/fieldErrors';
import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/FormFields';
import { ErrorBanner } from '@/shared/ui/StatusMessages';

import { useUpdateProviderModel } from '../api/providerQueries';
import type { ProviderModelResponse } from '../api/providerTypes';
import {
  MODEL_SETTINGS_FIELD_NAMES,
  modelSettingsValuesFrom,
  toModelUpdateRequest,
  validateModelSettings,
} from '../modelSettingsModel';
import type { ModelSettingsValues } from '../modelSettingsModel';
import { ModelBreakerFields } from './ModelBreakerFields';
import { ModelEndpointOverrideFields } from './ModelEndpointOverrideFields';
import { ModelLimitFields } from './ModelLimitFields';
import { ModelReasoningControlFields } from './ModelReasoningControlFields';

/** Inline editor for a model's name, limits, vision, reasoning control, breaker and endpoint override. */
export function ModelSettingsForm({ model, onSaved }: { model: ProviderModelResponse; onSaved: () => void }) {
  const updateModelMutation = useUpdateProviderModel();
  const [values, setValues] = useState<ModelSettingsValues>(() => modelSettingsValuesFrom(model));
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMessages>({});
  const [generalErrorMessage, setGeneralErrorMessage] = useState<string | null>(null);

  const updateValues = (changes: Partial<ModelSettingsValues>) => setValues((current) => ({ ...current, ...changes }));
  const fieldGroupProps = { values, fieldErrors, onChange: updateValues };

  const handleSubmit = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const validationErrors = validateModelSettings(values);
    setFieldErrors(validationErrors);
    setGeneralErrorMessage(null);
    if (Object.keys(validationErrors).length > 0) return;
    updateModelMutation.mutate(
      { modelPk: model.id, request: toModelUpdateRequest(values) },
      {
        onSuccess: onSaved,
        onError: (error) => {
          const splitError = splitApiError(error, MODEL_SETTINGS_FIELD_NAMES);
          setFieldErrors(splitError.fieldErrors);
          setGeneralErrorMessage(splitError.generalMessage);
        },
      },
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mt-3 flex flex-col gap-4 rounded border border-border bg-surface-raised p-4"
    >
      {generalErrorMessage ? <ErrorBanner message={generalErrorMessage} /> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField
          label="Display name"
          value={values.displayName}
          maxLength={200}
          placeholder={model.model_id}
          onChange={(changeEvent) => updateValues({ displayName: changeEvent.target.value })}
          errorMessage={fieldErrors.display_name}
        />
        <ModelReasoningControlFields {...fieldGroupProps} />
      </div>
      <ModelLimitFields {...fieldGroupProps} />
      <ModelBreakerFields {...fieldGroupProps} />
      <ModelEndpointOverrideFields {...fieldGroupProps} />
      <div>
        <Button type="submit" variant="primary" size="small" isLoading={updateModelMutation.isPending}>
          Save model
        </Button>
      </div>
    </form>
  );
}
