import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { splitApiError } from '@/shared/lib/fieldErrors';
import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '@/shared/ui/FormFields';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useCreateClientBlock } from '../api/clientBlockQueries';
import {
  BLOCK_DURATION_OPTIONS,
  CLIENT_BLOCK_FORM_FIELD_NAMES,
  MAXIMUM_REASON_LENGTH,
  emptyClientBlockFormValues,
  toClientBlockCreateRequest,
  validateClientBlockForm,
} from '../clientBlockFormModel';
import type { BlockDurationChoice, ClientBlockFormValues, ClientBlockTargetKind } from '../clientBlockFormModel';

const TARGET_KIND_OPTIONS: readonly { value: ClientBlockTargetKind; label: string }[] = [
  { value: 'visitorSession', label: 'A visitor session (its address and device)' },
  { value: 'ipAddress', label: 'A network address' },
];

export interface CreateClientBlockDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Prefills the form to block the visitor of a conversation. */
  initialVisitorSessionId?: string;
}

export function CreateClientBlockDialog(props: CreateClientBlockDialogProps) {
  return (
    <Dialog
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Block a client"
      description="Blocked until the block expires or is lifted."
    >
      {props.isOpen ? <CreateClientBlockForm {...props} /> : null}
    </Dialog>
  );
}

function isTargetKind(value: string): value is ClientBlockTargetKind {
  return TARGET_KIND_OPTIONS.some((option) => option.value === value);
}

function isDurationChoice(value: string): value is BlockDurationChoice {
  return BLOCK_DURATION_OPTIONS.some((option) => option.value === value);
}

function CreateClientBlockForm({ onClose, initialVisitorSessionId }: CreateClientBlockDialogProps) {
  const { showToast } = useToast();
  const createBlockMutation = useCreateClientBlock();
  const [values, setValues] = useState<ClientBlockFormValues>(() =>
    emptyClientBlockFormValues(initialVisitorSessionId),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMessages>({});
  const [generalErrorMessage, setGeneralErrorMessage] = useState<string | null>(null);
  const updateValues = (changes: Partial<ClientBlockFormValues>) =>
    setValues((current) => ({ ...current, ...changes }));

  const handleSubmit = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const now = Date.now();
    const validationErrors = validateClientBlockForm(values, now);
    setFieldErrors(validationErrors);
    setGeneralErrorMessage(null);
    if (Object.keys(validationErrors).length > 0) return;
    createBlockMutation.mutate(toClientBlockCreateRequest(values, now), {
      onSuccess: () => {
        showToast('Client blocked.', 'success');
        onClose();
      },
      onError: (error) => {
        const splitError = splitApiError(error, CLIENT_BLOCK_FORM_FIELD_NAMES);
        setFieldErrors(splitError.fieldErrors);
        setGeneralErrorMessage(splitError.generalMessage);
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {generalErrorMessage ? <ErrorBanner message={generalErrorMessage} /> : null}
      <SelectField
        label="Block"
        value={values.targetKind}
        options={TARGET_KIND_OPTIONS}
        onChange={(changeEvent) => {
          if (isTargetKind(changeEvent.target.value)) updateValues({ targetKind: changeEvent.target.value });
        }}
      />
      {values.targetKind === 'visitorSession' ? (
        <TextField
          label="Visitor session id"
          value={values.visitorSessionId}
          spellCheck={false}
          autoComplete="off"
          onChange={(changeEvent) => updateValues({ visitorSessionId: changeEvent.target.value })}
          helpText="Blocks the session's address and device."
          errorMessage={fieldErrors.visitorSessionId}
        />
      ) : (
        <TextField
          label="IP address"
          value={values.ipAddress}
          spellCheck={false}
          autoComplete="off"
          placeholder="203.0.113.7"
          onChange={(changeEvent) => updateValues({ ipAddress: changeEvent.target.value })}
          helpText="Stored as a keyed hash; not shown again."
          errorMessage={fieldErrors.ipAddress}
        />
      )}
      <TextAreaField
        label="Reason"
        value={values.reason}
        maxLength={MAXIMUM_REASON_LENGTH}
        placeholder="Why this client is blocked, for other admins"
        onChange={(changeEvent) => updateValues({ reason: changeEvent.target.value })}
        errorMessage={fieldErrors.reason}
      />
      <SelectField
        label="Lift the block after"
        value={values.durationChoice}
        options={BLOCK_DURATION_OPTIONS}
        onChange={(changeEvent) => {
          if (isDurationChoice(changeEvent.target.value)) updateValues({ durationChoice: changeEvent.target.value });
        }}
        errorMessage={values.durationChoice === 'custom' ? undefined : fieldErrors.expiresAt}
      />
      {values.durationChoice === 'custom' ? (
        <TextField
          label="Block ends at"
          type="datetime-local"
          value={values.customExpiresAt}
          onChange={(changeEvent) => updateValues({ customExpiresAt: changeEvent.target.value })}
          errorMessage={fieldErrors.expiresAt}
        />
      ) : null}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="danger" isLoading={createBlockMutation.isPending}>
          Block client
        </Button>
      </div>
    </form>
  );
}
