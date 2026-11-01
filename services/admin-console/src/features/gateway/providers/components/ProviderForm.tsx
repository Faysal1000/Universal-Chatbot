import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { joinClassNames } from '@/shared/lib/classNames';
import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { Button } from '@/shared/ui/Button';
import { SelectField, TextField } from '@/shared/ui/FormFields';
import { Card } from '@/shared/ui/Layout';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';

import type { ProviderResponse } from '../api/providerTypes';
import { API_PROTOCOL_OPTIONS, isApiProtocolName } from '../protocols';
import { initialProviderFormValues, validateProviderForm } from '../providerFormModel';
import type { ProviderFormValues } from '../providerFormModel';
import { ExtraHeadersEditor } from './ExtraHeadersEditor';

export interface ProviderFormProps {
  /** The provider being edited, or `undefined` when creating one. */
  provider: ProviderResponse | undefined;
  isSubmitting: boolean;
  serverFieldErrors: FieldErrorMessages;
  serverErrorMessage: string | null;
  onSubmit: (values: ProviderFormValues) => void;
  onCancel: () => void;
}

export function ProviderForm({
  provider,
  isSubmitting,
  serverFieldErrors,
  serverErrorMessage,
  onSubmit,
  onCancel,
}: ProviderFormProps) {
  const isNewProvider = provider === undefined;
  const [formValues, setFormValues] = useState<ProviderFormValues>(() => initialProviderFormValues(provider));
  const [clientFieldErrors, setClientFieldErrors] = useState<FieldErrorMessages>({});
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const fieldErrors = { ...serverFieldErrors, ...clientFieldErrors };

  const updateFormValues = (changes: Partial<ProviderFormValues>) => {
    setFormValues((currentValues) => ({ ...currentValues, ...changes }));
  };

  const handleSubmit = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const validationErrors = validateProviderForm(formValues, isNewProvider);
    setClientFieldErrors(validationErrors);
    if (validationErrors.request_timeout_seconds || validationErrors.max_concurrent_requests) setIsAdvancedOpen(true);
    if (Object.keys(validationErrors).length > 0) return;
    onSubmit(formValues);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card title="Connection">
        <div className="flex max-w-2xl flex-col gap-5">
          {serverErrorMessage ? <ErrorBanner message={serverErrorMessage} /> : null}
          <TextField
            label="Provider ID"
            value={formValues.providerId}
            onChange={(changeEvent) => updateFormValues({ providerId: changeEvent.target.value.toLowerCase() })}
            disabled={!isNewProvider}
            required
            maxLength={63}
            autoComplete="off"
            spellCheck={false}
            placeholder="deepseek"
            helpText={
              isNewProvider
                ? 'Lowercase, starts with a letter. Used in requests and as the credential name.'
                : undefined
            }
            errorMessage={fieldErrors.provider_id}
          />
          <TextField
            label="Display name"
            value={formValues.displayName}
            onChange={(changeEvent) => updateFormValues({ displayName: changeEvent.target.value })}
            required
            maxLength={200}
            placeholder="DeepSeek"
            errorMessage={fieldErrors.display_name}
          />
          <TextField
            label="Base URL"
            type="url"
            value={formValues.baseUrl}
            onChange={(changeEvent) => updateFormValues({ baseUrl: changeEvent.target.value })}
            required
            maxLength={2048}
            spellCheck={false}
            placeholder="https://gateway.example/v1"
            errorMessage={fieldErrors.base_url}
          />
          <SelectField
            label="API protocol"
            value={formValues.apiProtocol}
            options={API_PROTOCOL_OPTIONS}
            onChange={(changeEvent) => {
              if (isApiProtocolName(changeEvent.target.value)) {
                updateFormValues({ apiProtocol: changeEvent.target.value });
              }
            }}
            errorMessage={fieldErrors.api_protocol}
          />
          <div className="flex flex-col gap-2">
            <TextField
              label="API key"
              type="password"
              autoComplete="new-password"
              value={formValues.apiKey}
              disabled={formValues.clearApiKey}
              onChange={(changeEvent) => updateFormValues({ apiKey: changeEvent.target.value })}
              maxLength={8192}
              placeholder={provider?.has_api_key ? 'Saved. Leave empty to keep it' : 'Enter your API key'}
              errorMessage={fieldErrors.api_key}
            />
            {provider?.has_api_key ? (
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={formValues.clearApiKey}
                  onChange={(changeEvent) => updateFormValues({ clearApiKey: changeEvent.target.checked, apiKey: '' })}
                  className="size-4 accent-[var(--accent)]"
                />
                Remove the saved API key
              </label>
            ) : null}
          </div>
          <ExtraHeadersEditor
            rows={formValues.extraHeaders}
            onChange={(extraHeaders) => updateFormValues({ extraHeaders })}
            errorMessage={fieldErrors.extra_headers}
          />

          <div className="rounded border border-border">
            <button
              type="button"
              aria-expanded={isAdvancedOpen}
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className="flex w-full items-center justify-between rounded px-3 py-2 text-sm font-medium text-primary hover:bg-surface-hover"
            >
              Advanced
              <ChevronDown
                aria-hidden="true"
                className={joinClassNames('size-4 text-muted transition-transform', isAdvancedOpen && 'rotate-180')}
              />
            </button>
            {isAdvancedOpen ? (
              <div className="grid grid-cols-1 gap-4 border-t border-border p-3 sm:grid-cols-2">
                <TextField
                  label="Request timeout (seconds)"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={1800}
                  step="any"
                  value={formValues.requestTimeoutSeconds}
                  onChange={(changeEvent) => updateFormValues({ requestTimeoutSeconds: changeEvent.target.value })}
                  helpText="1–1800 s per upstream call."
                  errorMessage={fieldErrors.request_timeout_seconds}
                />
                <TextField
                  label="Max concurrent requests"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000}
                  step={1}
                  value={formValues.maxConcurrentRequests}
                  onChange={(changeEvent) => updateFormValues({ maxConcurrentRequests: changeEvent.target.value })}
                  helpText="1–10,000. Extra calls wait for a slot."
                  errorMessage={fieldErrors.max_concurrent_requests}
                />
              </div>
            ) : null}
          </div>

          <ToggleSwitch
            isOn={formValues.isEnabled}
            onChange={(isEnabled) => updateFormValues({ isEnabled })}
            label="Enabled"
          />

          <div className="flex gap-2 border-t border-border pt-4">
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              {isNewProvider ? 'Create provider' : 'Save changes'}
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      </Card>
    </form>
  );
}
