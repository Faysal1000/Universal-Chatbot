import { TextField } from '@/shared/ui/FormFields';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';

import type { ModelSettingsFieldGroupProps } from '../modelSettingsModel';

/** Token limits and capabilities that routing and callers rely on. */
export function ModelLimitFields({ values, fieldErrors, onChange }: ModelSettingsFieldGroupProps) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-sm font-medium text-primary">Limits and capabilities</legend>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TokenCountField
          label="Context window tokens"
          value={values.contextWindowTokens}
          placeholder="Unknown"
          errorMessage={fieldErrors.context_window_tokens}
          onChange={(contextWindowTokens) => onChange({ contextWindowTokens })}
        />
        <TokenCountField
          label="Max output tokens"
          value={values.maxOutputTokens}
          placeholder="Unknown"
          errorMessage={fieldErrors.max_output_tokens}
          onChange={(maxOutputTokens) => onChange({ maxOutputTokens })}
        />
        <TokenCountField
          label="Default output tokens"
          value={values.defaultMaxOutputTokens}
          placeholder="Provider default"
          errorMessage={fieldErrors.default_max_output_tokens}
          onChange={(defaultMaxOutputTokens) => onChange({ defaultMaxOutputTokens })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <ToggleSwitch
          isOn={values.supportsVision}
          onChange={(supportsVision) => onChange({ supportsVision })}
          label="Vision (accepts image input)"
        />
        {fieldErrors.capabilities ? (
          <p className="text-xs text-critical-text" role="alert">
            {fieldErrors.capabilities}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

interface TokenCountFieldProps {
  label: string;
  value: string;
  placeholder: string;
  errorMessage: string | undefined;
  onChange: (value: string) => void;
}

function TokenCountField({ label, value, placeholder, errorMessage, onChange }: TokenCountFieldProps) {
  return (
    <TextField
      label={label}
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      value={value}
      placeholder={placeholder}
      onChange={(changeEvent) => onChange(changeEvent.target.value)}
      errorMessage={errorMessage}
    />
  );
}
