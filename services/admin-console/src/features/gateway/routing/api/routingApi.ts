import { requestGatewayApi } from '@/shared/api/httpClient';

import type {
  CircuitBreakerResetResponse,
  CircuitBreakerResponse,
  GatewaySettingsResponse,
  GatewaySettingsUpdateRequest,
  ModelChainRequest,
  TaskRouteCreateRequest,
  TaskResponse,
  TaskRouteResponse,
  TaskRouteUpdateRequest,
} from './routingTypes';

function taskRoutePath(taskName: string): string {
  return `/routes/${encodeURIComponent(taskName)}`;
}

export function listTasks(): Promise<TaskResponse[]> {
  return requestGatewayApi<TaskResponse[]>('/tasks');
}

export function listTaskRoutes(): Promise<TaskRouteResponse[]> {
  return requestGatewayApi<TaskRouteResponse[]>('/routes');
}

export function createTaskRoute(request: TaskRouteCreateRequest): Promise<TaskRouteResponse> {
  return requestGatewayApi<TaskRouteResponse>('/routes', { method: 'POST', body: request });
}

export function updateTaskRoute(taskName: string, request: TaskRouteUpdateRequest): Promise<TaskRouteResponse> {
  return requestGatewayApi<TaskRouteResponse>(taskRoutePath(taskName), { method: 'PATCH', body: request });
}

/** Replaces the route's whole chain atomically (creates the route when missing). */
export function replaceTaskRouteChain(taskName: string, request: ModelChainRequest): Promise<TaskRouteResponse> {
  return requestGatewayApi<TaskRouteResponse>(`${taskRoutePath(taskName)}/chain`, { method: 'PUT', body: request });
}

export function deleteTaskRoute(taskName: string): Promise<void> {
  return requestGatewayApi<undefined>(taskRoutePath(taskName), { method: 'DELETE' });
}

export function listCircuitBreakers(): Promise<CircuitBreakerResponse[]> {
  return requestGatewayApi<CircuitBreakerResponse[]>('/circuit-breakers');
}

export function resetCircuitBreaker(modelPk: number): Promise<void> {
  return requestGatewayApi<undefined>(`/circuit-breakers/${modelPk}/reset`, { method: 'POST' });
}

export function resetAllCircuitBreakers(): Promise<CircuitBreakerResetResponse> {
  return requestGatewayApi<CircuitBreakerResetResponse>('/circuit-breakers/reset', { method: 'POST' });
}

export function getGatewaySettings(): Promise<GatewaySettingsResponse> {
  return requestGatewayApi<GatewaySettingsResponse>('/settings');
}

export function updateGatewaySettings(request: GatewaySettingsUpdateRequest): Promise<GatewaySettingsResponse> {
  return requestGatewayApi<GatewaySettingsResponse>('/settings', { method: 'PUT', body: request });
}
