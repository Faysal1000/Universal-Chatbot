import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { ApiError } from '@/shared/api/httpClient';
import { splitApiError } from '@/shared/lib/fieldErrors';
import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { TextField } from '@/shared/ui/FormFields';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useCreateDeployment, useUpdateDeployment } from '../api/localModelQueries';
import { MAXIMUM_DEPLOYMENT_NAME_LENGTH } from '../api/localModelTypes';
import type { Deployment } from '../api/localModelTypes';
import {
  DEPLOYMENT_FORM_FIELD_NAMES,
  deploymentFormValuesFrom,
  emptyDeploymentFormValues,
  isModelSwap,
  toDeploymentCreateRequest,
  toDeploymentUpdateRequest,
  validateDeploymentForm,
} from '../deploymentFormModel';
import type { DeploymentFormValues } from '../deploymentFormModel';
import { describeRefusal } from '../refusalModel';
import { DeploymentFormFields } from './DeploymentFormFields';

export interface DeploymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The deployment being edited; `undefined` to deploy a new model. */
  existingDeployment: Deployment | undefined;
  /** `false` when the host has no GPU budget; `undefined` while unknown. */
  isGpuAvailable: boolean | undefined;
}

/** Dialog wrapper; the form re-mounts for each open so it starts from fresh values. */
export function DeploymentDialog(props: DeploymentDialogProps) {
  const { isOpen, onClose, existingDeployment } = props;
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      width="large"
      title={existingDeployment ? `Edit “${existingDeployment.name}”` : 'Deploy model'}
      description={
        existingDeployment
          ? 'Applies now. A new model id or revision swaps without downtime when memory allows.'
          : undefined
      }
    >
      {isOpen ? <DeploymentForm {...props} /> : null}
    </Dialog>
  );
}

interface FormErrors {
  fieldErrors: FieldErrorMessages;
  generalMessage: string | null;
}

const NO_FORM_ERRORS: FormErrors = { fieldErrors: {}, generalMessage: null };

/** Schema errors go to their fields; refusals (memory, model, GPU, name) get a readable sentence. */
function toFormErrors(error: unknown): FormErrors {
  if (error instanceof ApiError && error.validationErrors.length > 0) {
    return splitApiError(error, DEPLOYMENT_FORM_FIELD_NAMES);
  }
  const refusal = describeRefusal(error);
  if (refusal.fieldName) return { fieldErrors: { [refusal.fieldName]: refusal.message }, generalMessage: null };
  return { fieldErrors: {}, generalMessage: refusal.message };
}

function DeploymentForm({ onClose, existingDeployment, isGpuAvailable }: DeploymentDialogProps) {
  const { showToast } = useToast();
  const createDeploymentMutation = useCreateDeployment();
  const updateDeploymentMutation = useUpdateDeployment();
  const [initialValues] = useState<DeploymentFormValues>(() =>
    existingDeployment ? deploymentFormValuesFrom(existingDeployment) : emptyDeploymentFormValues(),
  );
  const [values, setValues] = useState<DeploymentFormValues>(initialValues);
  const [formErrors, setFormErrors] = useState<FormErrors>(NO_FORM_ERRORS);
  const updateValues = (changes: Partial<DeploymentFormValues>) => setValues((current) => ({ ...current, ...changes }));
  const handleError = (error: unknown) => setFormErrors(toFormErrors(error));

  const finishWithToast = (message: string) => {
    showToast(message, 'success');
    onClose();
  };

  const submitUpdate = (deployment: Deployment) => {
    const request = toDeploymentUpdateRequest(initialValues, values);
    if (Object.keys(request).length === 0) {
      onClose();
      return;
    }
    const successMessage = isModelSwap(request)
      ? `Swapping the model of ${deployment.name}; the current model serves until the new one is ready.`
      : `Settings of ${deployment.name} saved.`;
    updateDeploymentMutation.mutate(
      { deploymentName: deployment.name, request },
      { onSuccess: () => finishWithToast(successMessage), onError: handleError },
    );
  };

  const submitCreate = () => {
    createDeploymentMutation.mutate(toDeploymentCreateRequest(values), {
      onSuccess: (createdDeployment) =>
        finishWithToast(`Deploying ${createdDeployment.name}: downloading and loading.`),
      onError: handleError,
    });
  };

  const handleSubmit = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const validationErrors = validateDeploymentForm(values, existingDeployment === undefined);
    setFormErrors({ fieldErrors: validationErrors, generalMessage: null });
    if (Object.keys(validationErrors).length > 0) return;
    if (existingDeployment) submitUpdate(existingDeployment);
    else submitCreate();
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {formErrors.generalMessage ? (
        <ErrorBanner
          title={existingDeployment ? 'local-llm refused the change' : 'local-llm refused the deployment'}
          message={formErrors.generalMessage}
        />
      ) : null}
      <TextField
        label="Name"
        value={values.name}
        disabled={existingDeployment !== undefined}
        onChange={(changeEvent) => updateValues({ name: changeEvent.target.value })}
        placeholder="qwen3.5-0.8b"
        maxLength={MAXIMUM_DEPLOYMENT_NAME_LENGTH}
        spellCheck={false}
        autoComplete="off"
        helpText="Model name in the gateway. Letters, digits, . : - _ · cannot be changed later."
        errorMessage={formErrors.fieldErrors.name}
      />
      <DeploymentFormFields
        values={values}
        fieldErrors={formErrors.fieldErrors}
        onChange={updateValues}
        isGpuAvailable={isGpuAvailable}
        isEditing={existingDeployment !== undefined}
      />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          isLoading={createDeploymentMutation.isPending || updateDeploymentMutation.isPending}
        >
          {existingDeployment ? 'Save settings' : 'Deploy model'}
        </Button>
      </div>
    </form>
  );
}
