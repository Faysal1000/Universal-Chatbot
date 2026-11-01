import { requestGatewayApi } from '@/shared/api/httpClient';

import type {
  ConnectionTestResponse,
  DiscoveredModelResponse,
  ProviderCreateRequest,
  ProviderModelCreateRequest,
  ProviderModelResponse,
  ProviderModelUpdateRequest,
  ProviderResponse,
  ProviderUpdateRequest,
} from './providerTypes';

const encode = encodeURIComponent;

export function listProviders(): Promise<ProviderResponse[]> {
  return requestGatewayApi<ProviderResponse[]>('/providers');
}

export function getProvider(providerId: string): Promise<ProviderResponse> {
  return requestGatewayApi<ProviderResponse>(`/providers/${encode(providerId)}`);
}

export function createProvider(request: ProviderCreateRequest): Promise<ProviderResponse> {
  return requestGatewayApi<ProviderResponse>('/providers', { method: 'POST', body: request });
}

export function updateProvider(providerId: string, request: ProviderUpdateRequest): Promise<ProviderResponse> {
  return requestGatewayApi<ProviderResponse>(`/providers/${encode(providerId)}`, { method: 'PATCH', body: request });
}

export function deleteProvider(providerId: string): Promise<void> {
  return requestGatewayApi<undefined>(`/providers/${encode(providerId)}`, { method: 'DELETE' });
}

export function discoverProviderModels(providerId: string): Promise<DiscoveredModelResponse[]> {
  return requestGatewayApi<DiscoveredModelResponse[]>(`/providers/${encode(providerId)}/discover-models`, {
    method: 'POST',
  });
}

export function createProviderModel(
  providerId: string,
  request: ProviderModelCreateRequest,
): Promise<ProviderModelResponse> {
  return requestGatewayApi<ProviderModelResponse>(`/providers/${encode(providerId)}/models`, {
    method: 'POST',
    body: request,
  });
}

export function updateProviderModel(
  modelPk: number,
  request: ProviderModelUpdateRequest,
): Promise<ProviderModelResponse> {
  return requestGatewayApi<ProviderModelResponse>(`/models/${modelPk}`, { method: 'PATCH', body: request });
}

export function deleteProviderModel(modelPk: number): Promise<void> {
  return requestGatewayApi<undefined>(`/models/${modelPk}`, { method: 'DELETE' });
}

export function testProviderModel(modelPk: number): Promise<ConnectionTestResponse> {
  return requestGatewayApi<ConnectionTestResponse>(`/models/${modelPk}/test`, { method: 'POST' });
}
