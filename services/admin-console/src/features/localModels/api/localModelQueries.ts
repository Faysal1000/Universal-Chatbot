import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deploymentsRefetchIntervalMilliseconds } from '../deploymentStatusModel';
import { localModelQueryKeys } from './localModelQueryKeys';
import type { DeploymentCreateRequest, DeploymentUpdateRequest } from './localModelTypes';
import {
  createDeployment,
  getSystem,
  listDeployments,
  removeDeployment,
  runDeploymentCommand,
  updateDeployment,
} from './localModelsApi';
import type { DeploymentCommand } from './localModelsApi';

/** Polls fast while any deployment is downloading, loading, unloading or swapping. */
export function useDeployments() {
  return useQuery({
    queryKey: localModelQueryKeys.deployments,
    queryFn: listDeployments,
    refetchInterval: (query) => deploymentsRefetchIntervalMilliseconds(query.state.data),
  });
}

/** Memory budgets move with the deployments, so the caller passes the deployments' polling interval. */
export function useSystem(refetchIntervalMilliseconds: number) {
  return useQuery({
    queryKey: localModelQueryKeys.system,
    queryFn: getSystem,
    refetchInterval: refetchIntervalMilliseconds,
  });
}

function useInvalidateLocalModels() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: localModelQueryKeys.all });
}

export function useCreateDeployment() {
  const invalidateLocalModels = useInvalidateLocalModels();
  return useMutation({
    mutationFn: (request: DeploymentCreateRequest) => createDeployment(request),
    onSuccess: invalidateLocalModels,
  });
}

export function useUpdateDeployment() {
  const invalidateLocalModels = useInvalidateLocalModels();
  return useMutation({
    mutationFn: ({ deploymentName, request }: { deploymentName: string; request: DeploymentUpdateRequest }) =>
      updateDeployment(deploymentName, request),
    onSuccess: invalidateLocalModels,
  });
}

export function useDeploymentCommand() {
  const invalidateLocalModels = useInvalidateLocalModels();
  return useMutation({
    mutationFn: ({ deploymentName, command }: { deploymentName: string; command: DeploymentCommand }) =>
      runDeploymentCommand(deploymentName, command),
    onSuccess: invalidateLocalModels,
  });
}

export function useRemoveDeployment() {
  const invalidateLocalModels = useInvalidateLocalModels();
  return useMutation({
    mutationFn: (deploymentName: string) => removeDeployment(deploymentName),
    onSuccess: invalidateLocalModels,
  });
}
