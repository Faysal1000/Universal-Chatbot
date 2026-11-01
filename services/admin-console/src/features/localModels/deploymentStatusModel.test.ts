import { describe, expect, it } from 'vitest';

import type { Deployment, DeploymentStatus } from './api/localModelTypes';
import {
  STEADY_REFETCH_INTERVAL_MILLISECONDS,
  TRANSITIONAL_REFETCH_INTERVAL_MILLISECONDS,
  availableDeploymentActions,
  deploymentsRefetchIntervalMilliseconds,
  describeTransitions,
  sortSystemDeploymentFirst,
  statusPlacardFor,
  throughputLines,
} from './deploymentStatusModel';

function aDeployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    name: 'qwen3.5-0.8b',
    display_name: null,
    model_id: 'unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M',
    revision: null,
    resolved_revision: null,
    engine: 'llama_cpp',
    is_system: false,
    status: 'ready',
    status_changed_at: '2026-10-30T10:00:00Z',
    loaded_at: '2026-10-30T10:00:00Z',
    device: 'auto',
    resolved_device: 'cpu',
    dtype: null,
    capabilities: [],
    context_window_tokens: 8192,
    max_output_tokens: 2048,
    reasoning_control: 'enable_thinking',
    configured: {
      revision: null,
      device: 'auto',
      dtype: 'auto',
      context_window_tokens: null,
      max_output_tokens: null,
      reasoning_control: 'auto',
    },
    default_for_tasks: [],
    memory: { estimated_bytes: null, reserved_bytes: null, measured_bytes: null },
    throughput: {
      window_seconds: 300,
      completed_requests: 0,
      generated_tokens: 0,
      tokens_per_second: null,
      pages_parsed: 0,
      seconds_per_page: null,
      pages_per_minute: null,
    },
    requests_in_flight: 0,
    requests_queued: 0,
    pending_update: null,
    last_error: null,
    ...overrides,
  };
}

const aSystemDeployment = (overrides: Partial<Deployment> = {}) =>
  aDeployment({ name: 'nemotron-parse', is_system: true, engine: 'transformers', ...overrides });

describe('statusPlacardFor', () => {
  it.each<[DeploymentStatus, string, string]>([
    ['ready', 'ready', 'Ready'],
    ['downloading', 'working', 'Downloading'],
    ['loading', 'working', 'Loading'],
    ['unloading', 'working', 'Unloading'],
    ['unloaded', 'stopped', 'Unloaded'],
    ['failed', 'failed', 'Failed'],
  ])('shows %s as a %s placard labelled %s', (status, expectedState, expectedLabel) => {
    expect(statusPlacardFor(status)).toEqual({ state: expectedState, label: expectedLabel });
  });
});

describe('deploymentsRefetchIntervalMilliseconds', () => {
  it('polls fast while a deployment is loading', () => {
    const deployments = [aDeployment(), aDeployment({ name: 'other', status: 'loading' })];
    expect(deploymentsRefetchIntervalMilliseconds(deployments)).toBe(TRANSITIONAL_REFETCH_INTERVAL_MILLISECONDS);
  });

  it('polls fast while a model swap is pending', () => {
    const deployments = [aDeployment({ pending_update: 'Swapping to org/new' })];
    expect(deploymentsRefetchIntervalMilliseconds(deployments)).toBe(TRANSITIONAL_REFETCH_INTERVAL_MILLISECONDS);
  });

  it('polls slowly when every deployment is settled or nothing is loaded yet', () => {
    const settledDeployments = [aDeployment(), aDeployment({ status: 'failed' }), aDeployment({ status: 'unloaded' })];
    expect(deploymentsRefetchIntervalMilliseconds(settledDeployments)).toBe(STEADY_REFETCH_INTERVAL_MILLISECONDS);
    expect(deploymentsRefetchIntervalMilliseconds(undefined)).toBe(STEADY_REFETCH_INTERVAL_MILLISECONDS);
  });
});

describe('availableDeploymentActions', () => {
  it('never offers Unload or Remove for the system deployment', () => {
    for (const status of ['ready', 'failed', 'unloaded', 'loading'] as const) {
      const actions = availableDeploymentActions(aSystemDeployment({ status }));
      expect(actions.has('unload')).toBe(false);
      expect(actions.has('remove')).toBe(false);
    }
  });

  it('offers Restart and Edit for the ready system deployment', () => {
    expect([...availableDeploymentActions(aSystemDeployment())].sort()).toEqual(['edit', 'restart']);
  });

  it('offers Unload, Restart, Edit and Remove for a ready admin deployment', () => {
    expect([...availableDeploymentActions(aDeployment())].sort()).toEqual(['edit', 'remove', 'restart', 'unload']);
  });

  it('offers Load for an unloaded or failed deployment', () => {
    expect(availableDeploymentActions(aDeployment({ status: 'unloaded' })).has('load')).toBe(true);
    expect(availableDeploymentActions(aDeployment({ status: 'failed' })).has('load')).toBe(true);
    expect(availableDeploymentActions(aDeployment()).has('load')).toBe(false);
  });

  it('withholds Edit while the deployment is loading', () => {
    expect(availableDeploymentActions(aDeployment({ status: 'loading' })).has('edit')).toBe(false);
  });
});

describe('sortSystemDeploymentFirst', () => {
  it('moves the system deployment to the top and keeps the rest in order', () => {
    const deployments = [aDeployment({ name: 'a' }), aSystemDeployment(), aDeployment({ name: 'b' })];
    expect(sortSystemDeploymentFirst(deployments).map((deployment) => deployment.name)).toEqual([
      'nemotron-parse',
      'a',
      'b',
    ]);
  });
});

describe('throughputLines', () => {
  it('reports tokens per second for a chat model', () => {
    const deployment = aDeployment({ throughput: { ...aDeployment().throughput, tokens_per_second: 47.25 } });
    expect(throughputLines(deployment)).toEqual(['47.3 tok/s']);
  });

  it('reports pages per minute and seconds per page for the parser', () => {
    const throughput = { ...aDeployment().throughput, pages_parsed: 3, pages_per_minute: 4.43, seconds_per_page: 13.4 };
    expect(throughputLines(aSystemDeployment({ throughput }))).toEqual(['4.4 pages/min', '13.4 s/page']);
  });

  it('shows dashes for the parser before it has parsed a page', () => {
    expect(throughputLines(aSystemDeployment())).toEqual(['— pages/min', '— s/page']);
  });
});

describe('describeTransitions', () => {
  it('names only the deployments that are changing state', () => {
    const deployments = [aDeployment({ name: 'a', status: 'downloading' }), aDeployment({ name: 'b' })];
    expect(describeTransitions(deployments)).toBe('a: Downloading.');
  });
});
