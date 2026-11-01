import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { routingQueryKeys } from '../../routing/api/routingQueryKeys';
import { providerQueryKeys } from './providerQueryKeys';
import type {
  ProviderCreateRequest,
  ProviderModelCreateRequest,
  ProviderModelUpdateRequest,
  ProviderUpdateRequest,
} from './providerTypes';
import {
  createProvider,
  createProviderModel,
  deleteProvider,
  deleteProviderModel,
  discoverProviderModels,
  getProvider,
  listProviders,
  testProviderModel,
  updateProvider,
  updateProviderModel,
} from './providersApi';

export function useProviders() {
  return useQuery({ queryKey: providerQueryKeys.all, queryFn: listProviders });
}

export function useProvider(providerId: string | undefined) {
  return useQuery({
    queryKey: providerQueryKeys.detail(providerId ?? ''),
    queryFn: () => getProvider(providerId ?? ''),
    enabled: providerId !== undefined,
  });
}

/** Provider changes can rename models shown in routes and settings, so refresh those too. */
function useInvalidateProviderData() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: routingQueryKeys.taskRoutes }),
      queryClient.invalidateQueries({ queryKey: routingQueryKeys.gatewaySettings }),
    ]);
}

export function useCreateProvider() {
  const invalidateProviderData = useInvalidateProviderData();
  return useMutation({
    mutationFn: (request: ProviderCreateRequest) => createProvider(request),
    onSuccess: invalidateProviderData,
  });
}

export function useUpdateProvider() {
  const invalidateProviderData = useInvalidateProviderData();
  return useMutation({
    mutationFn: ({ providerId, request }: { providerId: string; request: ProviderUpdateRequest }) =>
      updateProvider(providerId, request),
    onSuccess: invalidateProviderData,
  });
}

export function useDeleteProvider() {
  const invalidateProviderData = useInvalidateProviderData();
  return useMutation({
    mutationFn: (providerId: string) => deleteProvider(providerId),
    onSuccess: invalidateProviderData,
  });
}

export function useDiscoverProviderModels() {
  return useMutation({ mutationFn: (providerId: string) => discoverProviderModels(providerId) });
}

export function useCreateProviderModel() {
  const invalidateProviderData = useInvalidateProviderData();
  return useMutation({
    mutationFn: ({ providerId, request }: { providerId: string; request: ProviderModelCreateRequest }) =>
      createProviderModel(providerId, request),
    onSuccess: invalidateProviderData,
  });
}

export function useUpdateProviderModel() {
  const invalidateProviderData = useInvalidateProviderData();
  return useMutation({
    mutationFn: ({ modelPk, request }: { modelPk: number; request: ProviderModelUpdateRequest }) =>
      updateProviderModel(modelPk, request),
    onSuccess: invalidateProviderData,
  });
}

export function useDeleteProviderModel() {
  const invalidateProviderData = useInvalidateProviderData();
  return useMutation({
    mutationFn: (modelPk: number) => deleteProviderModel(modelPk),
    onSuccess: invalidateProviderData,
  });
}

export function useTestProviderModel() {
  return useMutation({ mutationFn: (modelPk: number) => testProviderModel(modelPk) });
}
