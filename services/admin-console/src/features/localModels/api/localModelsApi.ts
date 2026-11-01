import { requestLocalLlmApi } from '@/shared/api/httpClient';

import type {
  Deployment,
  DeploymentCreateRequest,
  DeploymentList,
  DeploymentUpdateRequest,
  SystemView,
} from './localModelTypes';

/** Lifecycle commands that take only the deployment name. */
export type DeploymentCommand = 'load' | 'unload' | 'restart';

function deploymentPath(deploymentName: string): string {
  return `/deployments/${encodeURIComponent(deploymentName)}`;
}

export function getSystem(): Promise<SystemView> {
  return requestLocalLlmApi<SystemView>('/system');
}

export async function listDeployments(): Promise<Deployment[]> {
  const deploymentList = await requestLocalLlmApi<DeploymentList>('/deployments');
  return deploymentList.data;
}

export function createDeployment(request: DeploymentCreateRequest): Promise<Deployment> {
  return requestLocalLlmApi<Deployment>('/deployments', { method: 'POST', body: request });
}

export function updateDeployment(deploymentName: string, request: DeploymentUpdateRequest): Promise<Deployment> {
  return requestLocalLlmApi<Deployment>(deploymentPath(deploymentName), { method: 'PATCH', body: request });
}

export function runDeploymentCommand(deploymentName: string, command: DeploymentCommand): Promise<Deployment> {
  return requestLocalLlmApi<Deployment>(`${deploymentPath(deploymentName)}/${command}`, { method: 'POST' });
}

export function removeDeployment(deploymentName: string): Promise<void> {
  return requestLocalLlmApi<undefined>(deploymentPath(deploymentName), { method: 'DELETE' });
}
