/** TanStack Query keys for the task list, task routes, circuit breakers and gateway-wide routing settings. */
export const routingQueryKeys = {
  tasks: ['tasks'] as const,
  taskRoutes: ['task-routes'] as const,
  circuitBreakers: ['circuit-breakers'] as const,
  gatewaySettings: ['gateway-settings'] as const,
};
