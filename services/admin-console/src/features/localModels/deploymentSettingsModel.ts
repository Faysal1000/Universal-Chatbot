/**
 * What the admin configured next to what local-llm resolved it to, e.g. "Device: Auto → CPU".
 * A setting left automatic shows "Auto"; a value the service has not resolved yet shows a dash.
 */
import { formatInteger, MISSING_VALUE_PLACEHOLDER } from '@/shared/lib/format';

import type { Deployment, ReasoningControl, RegisteredReasoningControl } from './api/localModelTypes';
import { deviceRequestLabel, resolvedDeviceLabel } from './deploymentStatusModel';

export interface SettingResolution {
  label: string;
  configured: string;
  resolved: string;
}

const AUTOMATIC = 'Auto';

const REASONING_CONTROL_LABELS: Record<ReasoningControl | RegisteredReasoningControl, string> = {
  auto: AUTOMATIC,
  reasoning_effort: 'reasoning effort',
  enable_thinking: 'thinking switch',
};

function reasoningControlLabel(reasoningControl: ReasoningControl): string {
  return REASONING_CONTROL_LABELS[reasoningControl];
}

export function settingResolutions(deployment: Deployment): SettingResolution[] {
  const { configured } = deployment;
  return [
    {
      label: 'Device',
      configured: deviceRequestLabel(configured.device),
      resolved: resolvedDeviceLabel(deployment.resolved_device),
    },
    {
      label: 'Data type',
      configured: configured.dtype === 'auto' ? AUTOMATIC : configured.dtype,
      resolved: deployment.dtype ?? (deployment.engine === 'llama_cpp' ? 'GGUF' : MISSING_VALUE_PLACEHOLDER),
    },
    {
      label: 'Context',
      configured: optionalTokenLabel(configured.context_window_tokens),
      resolved: optionalTokenLabel(deployment.context_window_tokens, MISSING_VALUE_PLACEHOLDER),
    },
    {
      label: 'Max output',
      configured: optionalTokenLabel(configured.max_output_tokens),
      resolved: optionalTokenLabel(deployment.max_output_tokens, MISSING_VALUE_PLACEHOLDER),
    },
    {
      label: 'Reasoning',
      configured: reasoningControlLabel(configured.reasoning_control),
      resolved: deployment.reasoning_control
        ? REASONING_CONTROL_LABELS[deployment.reasoning_control]
        : 'gateway setting',
    },
  ];
}

function optionalTokenLabel(tokenCount: number | null, whenUnset = AUTOMATIC): string {
  return tokenCount === null ? whenUnset : formatInteger(tokenCount);
}
