import { describe, expect, it } from 'vitest';

import type { Deployment } from './api/localModelTypes';
import { settingResolutions } from './deploymentSettingsModel';

const ggufDeployment = {
  engine: 'llama_cpp',
  device: 'auto',
  resolved_device: 'cpu',
  dtype: null,
  context_window_tokens: 8192,
  max_output_tokens: 2048,
  reasoning_control: 'enable_thinking',
  configured: {
    revision: null,
    device: 'auto',
    dtype: 'auto',
    context_window_tokens: null,
    max_output_tokens: 2048,
    reasoning_control: 'auto',
  },
} as unknown as Deployment;

function resolutionOf(deployment: Deployment, label: string) {
  return settingResolutions(deployment).find((resolution) => resolution.label === label);
}

describe('settingResolutions', () => {
  it('shows an automatic device next to the device it resolved to', () => {
    expect(resolutionOf(ggufDeployment, 'Device')).toMatchObject({ configured: 'Auto', resolved: 'CPU' });
  });

  it('shows a blank context window as Auto and the window the model got', () => {
    expect(resolutionOf(ggufDeployment, 'Context')).toMatchObject({ configured: 'Auto', resolved: '8,192' });
  });

  it('keeps a configured token limit as typed', () => {
    expect(resolutionOf(ggufDeployment, 'Max output')).toMatchObject({ configured: '2,048', resolved: '2,048' });
  });

  it('says a GGUF model fixes its own data type', () => {
    expect(resolutionOf(ggufDeployment, 'Data type')).toMatchObject({ configured: 'Auto', resolved: 'GGUF' });
  });

  it('shows the reasoning control registered with the gateway', () => {
    expect(resolutionOf(ggufDeployment, 'Reasoning')).toMatchObject({
      configured: 'Auto',
      resolved: 'thinking switch',
    });
  });

  it('says reasoning is left to the gateway when nothing is registered', () => {
    const unloaded = { ...ggufDeployment, reasoning_control: null, resolved_device: null } as Deployment;
    expect(resolutionOf(unloaded, 'Reasoning')?.resolved).toBe('gateway setting');
    expect(resolutionOf(unloaded, 'Device')?.resolved).toBe('—');
  });
});
