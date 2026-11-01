import type { ModelCapability, ProviderModelResponse } from './providerTypes';

export const VISION_CAPABILITY: ModelCapability = 'vision';

export function hasModelCapability(
  model: Pick<ProviderModelResponse, 'capabilities'>,
  capability: ModelCapability,
): boolean {
  return model.capabilities.includes(capability);
}
