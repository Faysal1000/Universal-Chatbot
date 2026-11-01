/** Pure presentation rules for deployments: status placards, polling, available actions and labels. */
import { formatTokensPerSecond, MISSING_VALUE_PLACEHOLDER } from '@/shared/lib/format';
import type { PlacardState } from '@/shared/ui/StatePlacard';

import type { Deployment, DeploymentStatus, DeviceRequest, EngineKind, ResolvedDevice } from './api/localModelTypes';

export const TRANSITIONAL_REFETCH_INTERVAL_MILLISECONDS = 2_000;
export const STEADY_REFETCH_INTERVAL_MILLISECONDS = 15_000;

export const SYSTEM_DEPLOYMENT_LABEL = 'System · required by RAG';

export interface StatusPlacard {
  state: PlacardState;
  label: string;
}

const STATUS_PLACARDS: Record<DeploymentStatus, StatusPlacard> = {
  ready: { state: 'ready', label: 'Ready' },
  downloading: { state: 'working', label: 'Downloading' },
  loading: { state: 'working', label: 'Loading' },
  unloading: { state: 'working', label: 'Unloading' },
  unloaded: { state: 'stopped', label: 'Unloaded' },
  failed: { state: 'failed', label: 'Failed' },
};

const TRANSITIONAL_STATUSES: ReadonlySet<DeploymentStatus> = new Set(['downloading', 'loading', 'unloading']);

export function statusPlacardFor(status: DeploymentStatus): StatusPlacard {
  return STATUS_PLACARDS[status];
}

/** Moving between states on its own: downloading, loading, unloading, or swapping to a new model. */
function isTransitional(deployment: Deployment): boolean {
  return TRANSITIONAL_STATUSES.has(deployment.status) || deployment.pending_update !== null;
}

export function deploymentsRefetchIntervalMilliseconds(deployments: readonly Deployment[] | undefined): number {
  const hasTransitionalDeployment = (deployments ?? []).some(isTransitional);
  return hasTransitionalDeployment ? TRANSITIONAL_REFETCH_INTERVAL_MILLISECONDS : STEADY_REFETCH_INTERVAL_MILLISECONDS;
}

/** System deployment first, then the service's order. */
export function sortSystemDeploymentFirst(deployments: readonly Deployment[]): Deployment[] {
  return [...deployments].sort((first, second) => Number(second.is_system) - Number(first.is_system));
}

export type DeploymentAction = 'load' | 'unload' | 'restart' | 'remove' | 'edit';

/**
 * Which actions make sense now. The system deployment can never be unloaded or removed (the
 * service answers 403); settings cannot change while a load or swap is under way (409).
 */
export function availableDeploymentActions(deployment: Deployment): ReadonlySet<DeploymentAction> {
  const { status, is_system: isSystem } = deployment;
  const actions = new Set<DeploymentAction>();
  if (status === 'unloaded' || status === 'failed') actions.add('load');
  if (status === 'ready' || status === 'failed') actions.add('restart');
  if (!isSystem && (status === 'ready' || status === 'downloading' || status === 'loading')) actions.add('unload');
  if (!isSystem) actions.add('remove');
  if (!isTransitional(deployment)) actions.add('edit');
  return actions;
}

const ENGINE_LABELS: Record<EngineKind, string> = { transformers: 'Transformers', llama_cpp: 'llama.cpp' };
const DEVICE_REQUEST_LABELS: Record<DeviceRequest, string> = { auto: 'Auto', gpu: 'GPU', cpu: 'CPU' };
const RESOLVED_DEVICE_LABELS: Record<ResolvedDevice, string> = { cpu: 'CPU', cuda: 'GPU (CUDA)' };

export function engineLabel(engine: EngineKind | null): string {
  return engine ? ENGINE_LABELS[engine] : MISSING_VALUE_PLACEHOLDER;
}

export function deviceRequestLabel(device: DeviceRequest): string {
  return DEVICE_REQUEST_LABELS[device];
}

export function resolvedDeviceLabel(device: ResolvedDevice | null): string {
  return device ? RESOLVED_DEVICE_LABELS[device] : MISSING_VALUE_PLACEHOLDER;
}

/** The document parser reports pages; chat models report tokens. */
function isDocumentParser(deployment: Deployment): boolean {
  return deployment.is_system || deployment.throughput.pages_parsed > 0;
}

/** One or two short throughput lines, e.g. ["84.2 tok/s"] or ["4.4 pages/min", "13.4 s/page"]. */
export function throughputLines(deployment: Deployment): string[] {
  const { throughput } = deployment;
  if (!isDocumentParser(deployment)) return [formatTokensPerSecond(throughput.tokens_per_second)];
  return [
    `${formatOneDecimal(throughput.pages_per_minute)} pages/min`,
    `${formatOneDecimal(throughput.seconds_per_page)} s/page`,
  ];
}

function formatOneDecimal(value: number | null): string {
  return value === null ? MISSING_VALUE_PLACEHOLDER : value.toFixed(1);
}

/** Spoken progress for an `aria-live` region, e.g. "qwen3.5-0.8b: Downloading." */
export function describeTransitions(deployments: readonly Deployment[]): string {
  return deployments
    .filter(isTransitional)
    .map((deployment) => `${deployment.name}: ${statusPlacardFor(deployment.status).label}.`)
    .join(' ');
}
