import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { splitApiError } from '@/shared/lib/fieldErrors';
import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { TextAreaField, TextField } from '@/shared/ui/FormFields';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useCreateWidgetKey, useUpdateWidgetKey } from '../api/widgetKeyQueries';
import type { WidgetKey } from '../api/widgetKeyTypes';
import {
  emptyWidgetKeyFormValues,
  MAXIMUM_NAME_LENGTH,
  MAXIMUM_TURNS_PER_MINUTE,
  toWidgetKeyCreateRequest,
  toWidgetKeyUpdateRequest,
  validateWidgetKeyForm,
  WIDGET_KEY_FORM_FIELD_NAMES,
  widgetKeyFormValuesOf,
} from '../widgetKeyFormModel';
import type { WidgetKeyFormValues } from '../widgetKeyFormModel';

export interface WidgetKeyDialogProps {
  isOpen: boolean;
  /** The key to edit; absent to add a website. */
  widgetKey?: WidgetKey | undefined;
  onClose: () => void;
  /** Called with a newly created key, so the page can show its embed code next. */
  onCreated?: (widgetKey: WidgetKey) => void;
}

export function WidgetKeyDialog(props: WidgetKeyDialogProps) {
  const isEditing = props.widgetKey !== undefined;
  return (
    <Dialog isOpen={props.isOpen} onClose={props.onClose} title={isEditing ? 'Edit website' : 'Add a website'}>
      {props.isOpen ? <WidgetKeyForm {...props} /> : null}
    </Dialog>
  );
}

function WidgetKeyForm({ widgetKey, onClose, onCreated }: WidgetKeyDialogProps) {
  const { showToast } = useToast();
  const createMutation = useCreateWidgetKey();
  const updateMutation = useUpdateWidgetKey();
  const [values, setValues] = useState<WidgetKeyFormValues>(() =>
    widgetKey ? widgetKeyFormValuesOf(widgetKey) : emptyWidgetKeyFormValues(),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMessages>({});
  const [generalErrorMessage, setGeneralErrorMessage] = useState<string | null>(null);
  const updateValues = (changes: Partial<WidgetKeyFormValues>) => setValues((current) => ({ ...current, ...changes }));

  const showServerErrors = (error: unknown) => {
    const splitError = splitApiError(error, WIDGET_KEY_FORM_FIELD_NAMES);
    setFieldErrors(splitError.fieldErrors);
    setGeneralErrorMessage(splitError.generalMessage);
  };

  const handleSubmit = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const validationErrors = validateWidgetKeyForm(values);
    setFieldErrors(validationErrors);
    setGeneralErrorMessage(null);
    if (Object.keys(validationErrors).length > 0) return;
    if (widgetKey) {
      updateMutation.mutate(
        { widgetKeyId: widgetKey.id, request: toWidgetKeyUpdateRequest(values) },
        {
          onSuccess: () => {
            showToast('Website updated.', 'success');
            onClose();
          },
          onError: showServerErrors,
        },
      );
      return;
    }
    createMutation.mutate(toWidgetKeyCreateRequest(values), {
      onSuccess: (created) => {
        showToast('Website added. Copy its embed code next.', 'success');
        onClose();
        onCreated?.(created);
      },
      onError: showServerErrors,
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {generalErrorMessage ? <ErrorBanner message={generalErrorMessage} /> : null}
      <TextField
        label="Name"
        value={values.name}
        maxLength={MAXIMUM_NAME_LENGTH}
        placeholder="Marketing site"
        onChange={(changeEvent) => updateValues({ name: changeEvent.target.value })}
        errorMessage={fieldErrors.name}
      />
      <TextAreaField
        label="Allowed websites"
        value={values.allowedOriginsText}
        spellCheck={false}
        placeholder={'https://www.example.com\nhttps://example.com'}
        onChange={(changeEvent) => updateValues({ allowedOriginsText: changeEvent.target.value })}
        helpText="One per line: scheme://host[:port]. No wildcards; list each subdomain."
        errorMessage={fieldErrors.allowedOrigins}
      />
      <TextField
        label="Answers per minute, all visitors together"
        type="number"
        inputMode="numeric"
        min={1}
        max={MAXIMUM_TURNS_PER_MINUTE}
        value={values.turnsPerMinute}
        onChange={(changeEvent) => updateValues({ turnsPerMinute: changeEvent.target.value })}
        helpText="Per-site cap on top of the per-visitor limits."
        errorMessage={fieldErrors.turnsPerMinute}
      />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" isLoading={createMutation.isPending || updateMutation.isPending}>
          {widgetKey ? 'Save changes' : 'Add website'}
        </Button>
      </div>
    </form>
  );
}
