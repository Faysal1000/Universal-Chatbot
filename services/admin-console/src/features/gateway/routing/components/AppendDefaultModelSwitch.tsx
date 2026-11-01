import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';

import { useGatewaySettings } from '../api/routingQueries';
import type { GatewaySettingsResponse } from '../api/routingTypes';
import { chainStepPosition } from '../chainFormModel';
import type { ChainStepValues } from '../chainFormModel';

export interface AppendDefaultModelSwitchProps {
  isOn: boolean;
  onChange: (isOn: boolean) => void;
  steps: readonly ChainStepValues[];
}

/** Route-level switch: try the gateway-wide default model after the chain's last step. */
export function AppendDefaultModelSwitch({ isOn, onChange, steps }: AppendDefaultModelSwitchProps) {
  const settingsQuery = useGatewaySettings();
  return (
    <div className="flex flex-col gap-1">
      <ToggleSwitch isOn={isOn} onChange={onChange} label="Then try the default model" />
      <p className="text-xs text-muted">{describeDefaultModel(settingsQuery.data, steps)}</p>
    </div>
  );
}

function describeDefaultModel(
  settings: GatewaySettingsResponse | undefined,
  steps: readonly ChainStepValues[],
): string {
  if (settings === undefined) return 'Loading the default model…';
  if (settings.default_model_pk === null) {
    return 'No default model is set, so this adds nothing until one is chosen under Default model.';
  }
  const stepWithDefaultModel = steps.find((step) => step.modelPk === String(settings.default_model_pk));
  const defaultModelName = settings.default_model_name ?? `model ${settings.default_model_pk}`;
  if (stepWithDefaultModel) {
    const position = chainStepPosition(steps, stepWithDefaultModel.rowKey) ?? 0;
    return `The default model, ${defaultModelName}, is already step ${position}; it is not tried twice.`;
  }
  return `The default model is ${defaultModelName}.`;
}
