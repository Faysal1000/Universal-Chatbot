import { VISION_CAPABILITY, hasModelCapability } from '../providers/api/modelCapabilities';
import type { ProviderResponse } from '../providers/api/providerTypes';
import { useTasks } from './api/routingQueries';
import type { TaskRouteResponse } from './api/routingTypes';
import { buildModelSelectOptions } from './modelOptions';

export interface TaskRouteModelOptions {
  modelOptions: ReturnType<typeof buildModelSelectOptions>;
  /** The catalogued task requires image input, so only vision models may serve it. */
  doesTaskRequireVision: boolean;
  isModelAllowedForTask: (modelPk: number) => boolean;
}

/** Model choices for a route, narrowed to vision models when the task's catalog entry requires vision. */
export function useTaskRouteModelOptions(
  providers: readonly ProviderResponse[],
  taskName: string,
  existingRoute: TaskRouteResponse | undefined,
): TaskRouteModelOptions {
  const tasksQuery = useTasks();
  const catalogTask = tasksQuery.data?.find((task) => task.task_name === taskName);
  const doesTaskRequireVision = catalogTask?.requires_vision ?? false;
  const visionModelPks = new Set(
    providers
      .flatMap((provider) => provider.models)
      .filter((model) => hasModelCapability(model, VISION_CAPABILITY))
      .map((model) => model.id),
  );
  return {
    modelOptions: buildModelSelectOptions(providers, {
      alwaysIncludeModelPks: existingRoute?.steps.map((step) => step.model_pk) ?? [],
      requiredCapability: doesTaskRequireVision ? VISION_CAPABILITY : undefined,
    }),
    doesTaskRequireVision,
    isModelAllowedForTask: (modelPk) => !doesTaskRequireVision || visionModelPks.has(modelPk),
  };
}
