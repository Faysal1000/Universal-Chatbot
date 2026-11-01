import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { SelectField, TextField } from '@/shared/ui/FormFields';
import type { SelectOption } from '@/shared/ui/FormFields';

import {
  DEVICE_REQUESTS,
  MAXIMUM_DISPLAY_NAME_LENGTH,
  MAXIMUM_MODEL_ID_LENGTH,
  MAXIMUM_REVISION_LENGTH,
  MODEL_DTYPES,
  REASONING_CONTROLS,
} from '../api/localModelTypes';
import type { DeviceRequest, ModelDtype, ReasoningControl } from '../api/localModelTypes';
import type { DeploymentFormValues } from '../deploymentFormModel';
import { DefaultTasksField } from './DefaultTasksField';

const DEVICE_OPTION_LABELS: Record<DeviceRequest, string> = {
  auto: 'Auto (GPU if it fits, else CPU)',
  gpu: 'GPU only',
  cpu: 'CPU only',
};

const DTYPE_OPTION_LABELS: Record<ModelDtype, string> = {
  auto: 'Auto (float32 on CPU, bfloat16 on GPU)',
  bfloat16: 'bfloat16',
  float16: 'float16',
  float32: 'float32',
};

const DTYPE_OPTIONS: SelectOption[] = MODEL_DTYPES.map((dtype) => ({
  value: dtype,
  label: DTYPE_OPTION_LABELS[dtype],
}));

const REASONING_CONTROL_OPTION_LABELS: Record<ReasoningControl, string> = {
  auto: 'Auto (detect from the chat template)',
  reasoning_effort: 'Reasoning effort',
  enable_thinking: 'Thinking switch (enable_thinking)',
};

const REASONING_CONTROL_OPTIONS: SelectOption[] = REASONING_CONTROLS.map((reasoningControl) => ({
  value: reasoningControl,
  label: REASONING_CONTROL_OPTION_LABELS[reasoningControl],
}));

export interface DeploymentFormFieldsProps {
  values: DeploymentFormValues;
  fieldErrors: FieldErrorMessages;
  onChange: (changes: Partial<DeploymentFormValues>) => void;
  /** `false` when the host has no GPU budget; `undefined` while unknown. */
  isGpuAvailable: boolean | undefined;
  isEditing: boolean;
}

/** Every setting of a deployment except its name. */
export function DeploymentFormFields({
  values,
  fieldErrors,
  onChange,
  isGpuAvailable,
  isEditing,
}: DeploymentFormFieldsProps) {
  const deviceOptions: SelectOption[] = DEVICE_REQUESTS.map((device) => ({
    value: device,
    label: DEVICE_OPTION_LABELS[device],
    disabled: device === 'gpu' && isGpuAvailable === false,
  }));
  const modelSwapNote = isEditing
    ? ' Changing it swaps the model: the old one keeps serving until the new one is ready.'
    : '';

  return (
    <>
      <TextField
        label="Hugging Face model id"
        value={values.modelId}
        onChange={(changeEvent) => onChange({ modelId: changeEvent.target.value })}
        placeholder="unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M"
        maxLength={MAXIMUM_MODEL_ID_LENGTH}
        spellCheck={false}
        autoComplete="off"
        helpText={
          <>
            <code>org/repo</code> for safetensors on Transformers; <code>org/repo:QUANT</code> (for example{' '}
            <code>unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M</code>) for llama.cpp.{modelSwapNote}
          </>
        }
        errorMessage={fieldErrors.model_id}
      />
      <TextField
        label="Revision"
        value={values.revision}
        onChange={(changeEvent) => onChange({ revision: changeEvent.target.value })}
        placeholder="main"
        maxLength={MAXIMUM_REVISION_LENGTH}
        spellCheck={false}
        autoComplete="off"
        helpText={`Optional commit SHA, branch or tag. Blank uses main.${modelSwapNote}`}
        errorMessage={fieldErrors.revision}
      />
      <TextField
        label="Display name"
        value={values.displayName}
        onChange={(changeEvent) => onChange({ displayName: changeEvent.target.value })}
        placeholder="Qwen3.5 0.8B (Q4)"
        maxLength={MAXIMUM_DISPLAY_NAME_LENGTH}
        errorMessage={fieldErrors.display_name}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Device"
          value={values.device}
          options={deviceOptions}
          onChange={(changeEvent) => onChange({ device: changeEvent.target.value as DeviceRequest })}
          helpText={
            isGpuAvailable === false
              ? 'This host has no usable GPU, so Auto runs on CPU.'
              : 'Auto uses the GPU when the model fits there, otherwise the CPU.'
          }
          errorMessage={fieldErrors.device}
        />
        <SelectField
          label="Data type"
          value={values.dtype}
          options={DTYPE_OPTIONS}
          onChange={(changeEvent) => onChange({ dtype: changeEvent.target.value as ModelDtype })}
          helpText="Transformers models only; GGUF files fix their own."
          errorMessage={fieldErrors.dtype}
        />
        <TextField
          label="Context window (tokens)"
          value={values.contextWindowTokens}
          onChange={(changeEvent) => onChange({ contextWindowTokens: changeEvent.target.value })}
          inputMode="numeric"
          placeholder="Model default"
          helpText="Optional, ≥ 256. Blank uses the model's window, capped."
          errorMessage={fieldErrors.context_window_tokens}
        />
        <TextField
          label="Max output tokens"
          value={values.maxOutputTokens}
          onChange={(changeEvent) => onChange({ maxOutputTokens: changeEvent.target.value })}
          inputMode="numeric"
          placeholder="Service default"
          errorMessage={fieldErrors.max_output_tokens}
        />
        <SelectField
          className="sm:col-span-2"
          label="Reasoning control"
          value={values.reasoningControl}
          options={REASONING_CONTROL_OPTIONS}
          onChange={(changeEvent) => onChange({ reasoningControl: changeEvent.target.value as ReasoningControl })}
          helpText="Auto uses the chat template's thinking switch (Qwen) when there is one. Changing it re-registers the model without a reload."
          errorMessage={fieldErrors.reasoning_control}
        />
      </div>
      <DefaultTasksField
        value={values.defaultForTasks}
        onChange={(defaultForTasks) => onChange({ defaultForTasks })}
        errorMessage={fieldErrors.default_for_tasks}
      />
    </>
  );
}
