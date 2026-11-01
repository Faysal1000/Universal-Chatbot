import { TextField } from '@/shared/ui/FormFields';

import type { ModelSettingsFieldGroupProps } from '../modelSettingsModel';

/** Per-model circuit-breaker settings; empty values use the gateway-wide defaults. */
export function ModelBreakerFields({ values, fieldErrors, onChange }: ModelSettingsFieldGroupProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-primary">Circuit breaker</legend>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TextField
          label="Failures before opening"
          inputMode="numeric"
          value={values.breakerFailureThreshold}
          placeholder="Gateway default (1–100)"
          onChange={(changeEvent) => onChange({ breakerFailureThreshold: changeEvent.target.value })}
          errorMessage={fieldErrors.breaker_failure_threshold}
        />
        <TextField
          label="Cooldown (seconds)"
          inputMode="numeric"
          value={values.breakerCooldownSeconds}
          placeholder="Gateway default (1–86,400)"
          onChange={(changeEvent) => onChange({ breakerCooldownSeconds: changeEvent.target.value })}
          errorMessage={fieldErrors.breaker_cooldown_seconds}
        />
      </div>
    </fieldset>
  );
}
