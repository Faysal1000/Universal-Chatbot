import { SelectField, TextField } from '@/shared/ui/FormFields';

import type { ApiProtocolName } from '../api/providerTypes';
import { PROVIDER_PROTOCOL_VALUE } from '../modelSettingsModel';
import type { ModelSettingsFieldGroupProps } from '../modelSettingsModel';
import { API_PROTOCOL_OPTIONS, isApiProtocolName } from '../protocols';

const PROTOCOL_OVERRIDE_OPTIONS = [
  { value: PROVIDER_PROTOCOL_VALUE, label: "Provider's protocol" },
  ...API_PROTOCOL_OPTIONS,
];

function toProtocolOverride(selectValue: string): ApiProtocolName | typeof PROVIDER_PROTOCOL_VALUE {
  return isApiProtocolName(selectValue) ? selectValue : PROVIDER_PROTOCOL_VALUE;
}

/** Advanced: serve this one model from a different endpoint or protocol than its provider. */
export function ModelEndpointOverrideFields({ values, fieldErrors, onChange }: ModelSettingsFieldGroupProps) {
  const hasOverride = values.baseUrlOverride !== '' || values.apiProtocolOverride !== PROVIDER_PROTOCOL_VALUE;
  const hasError = Boolean(fieldErrors.base_url_override ?? fieldErrors.api_protocol_override);
  return (
    <details open={hasOverride || hasError} className="rounded border border-border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-primary">Endpoint override (advanced)</summary>
      <div className="mt-3 grid grid-cols-1 gap-4 pb-1 md:grid-cols-2">
        <TextField
          label="Base URL override"
          type="url"
          value={values.baseUrlOverride}
          placeholder="Provider's base URL"
          spellCheck={false}
          autoComplete="off"
          maxLength={2048}
          onChange={(changeEvent) => onChange({ baseUrlOverride: changeEvent.target.value })}
          errorMessage={fieldErrors.base_url_override}
        />
        <SelectField
          label="Protocol override"
          value={values.apiProtocolOverride}
          options={PROTOCOL_OVERRIDE_OPTIONS}
          onChange={(changeEvent) => onChange({ apiProtocolOverride: toProtocolOverride(changeEvent.target.value) })}
          errorMessage={fieldErrors.api_protocol_override}
        />
      </div>
    </details>
  );
}
