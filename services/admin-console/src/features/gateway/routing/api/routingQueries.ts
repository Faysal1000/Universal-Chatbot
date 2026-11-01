import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createTaskRoute,
  deleteTaskRoute,
  getGatewaySettings,
  listCircuitBreakers,
  listTasks,
  listTaskRoutes,
  replaceTaskRouteChain,
  resetAllCircuitBreakers,
  resetCircuitBreaker,
  updateGatewaySettings,
  updateTaskRoute,
} from './routingApi';
import { routingQueryKeys } from './routingQueryKeys';
import type {
  GatewaySettingsUpdateRequest,
  ModelChainRequest,
  TaskRouteCreateRequest,
  TaskRouteUpdateRequest,
} from './routingTypes';

/** Breaker state changes with traffic, not with admin edits, so it is polled. */
const CIRCUIT_BREAKER_REFRESH_MILLISECONDS = 15_000;

export function useTasks() {
  return useQuery({ queryKey: routingQueryKeys.tasks, queryFn: listTasks });
}

export function useTaskRoutes() {
  return useQuery({ queryKey: routingQueryKeys.taskRoutes, queryFn: listTaskRoutes });
}

export function useGatewaySettings() {
  return useQuery({ queryKey: routingQueryKeys.gatewaySettings, queryFn: getGatewaySettings });
}

/** Route changes flip the task list's `has_route`. */
function useInvalidateTaskRoutes() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: routingQueryKeys.taskRoutes }),
      queryClient.invalidateQueries({ queryKey: routingQueryKeys.tasks }),
    ]);
}

export function useCreateTaskRoute() {
  const invalidateTaskRoutes = useInvalidateTaskRoutes();
  return useMutation({
    mutationFn: (request: TaskRouteCreateRequest) => createTaskRoute(request),
    onSuccess: invalidateTaskRoutes,
  });
}

export function useUpdateTaskRoute() {
  const invalidateTaskRoutes = useInvalidateTaskRoutes();
  return useMutation({
    mutationFn: ({ taskName, request }: { taskName: string; request: TaskRouteUpdateRequest }) =>
      updateTaskRoute(taskName, request),
    onSuccess: invalidateTaskRoutes,
  });
}

export function useReplaceTaskRouteChain() {
  const invalidateTaskRoutes = useInvalidateTaskRoutes();
  return useMutation({
    mutationFn: ({ taskName, request }: { taskName: string; request: ModelChainRequest }) =>
      replaceTaskRouteChain(taskName, request),
    onSuccess: invalidateTaskRoutes,
  });
}

export function useDeleteTaskRoute() {
  const invalidateTaskRoutes = useInvalidateTaskRoutes();
  return useMutation({
    mutationFn: (taskName: string) => deleteTaskRoute(taskName),
    onSuccess: invalidateTaskRoutes,
  });
}

export function useUpdateGatewaySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: GatewaySettingsUpdateRequest) => updateGatewaySettings(request),
    onSuccess: (settings) => {
      queryClient.setQueryData(routingQueryKeys.gatewaySettings, settings);
      return queryClient.invalidateQueries({ queryKey: routingQueryKeys.taskRoutes });
    },
  });
}

export function useCircuitBreakers() {
  return useQuery({
    queryKey: routingQueryKeys.circuitBreakers,
    queryFn: listCircuitBreakers,
    refetchInterval: CIRCUIT_BREAKER_REFRESH_MILLISECONDS,
  });
}

/** Breaker resets also change each route step's `breaker_status`. */
function useInvalidateCircuitBreakers() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: routingQueryKeys.circuitBreakers }),
      queryClient.invalidateQueries({ queryKey: routingQueryKeys.taskRoutes }),
    ]);
}

export function useResetCircuitBreaker() {
  const invalidateCircuitBreakers = useInvalidateCircuitBreakers();
  return useMutation({
    mutationFn: (modelPk: number) => resetCircuitBreaker(modelPk),
    onSuccess: invalidateCircuitBreakers,
  });
}

export function useResetAllCircuitBreakers() {
  const invalidateCircuitBreakers = useInvalidateCircuitBreakers();
  return useMutation({ mutationFn: resetAllCircuitBreakers, onSuccess: invalidateCircuitBreakers });
}
