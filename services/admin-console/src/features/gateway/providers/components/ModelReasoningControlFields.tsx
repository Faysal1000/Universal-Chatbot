import { SelectField } from '@/shared/ui/FormFields';

import { REASONING_CONTROL_CHOICES, isReasoningControl } from '../modelSettingsModel';
import type { ModelSettingsFieldGroupProps } from '../modelSettingsModel';

/** How a caller's reasoning_effort reaches the model. */
export function ModelReasoningControlFields({ values, fieldErrors, onChange }: ModelSettingsFieldGroupProps) {
  return (
    <SelectField
      label="Reasoning control"
      value={values.reasoningControl}
      options={REASONING_CONTROL_CHOICES}
      onChange={(changeEvent) => {
        if (isReasoningControl(changeEvent.target.value)) onChange({ reasoningControl: changeEvent.target.value });
      }}
      errorMessage={fieldErrors.reasoning_control}
    />
  );
}
