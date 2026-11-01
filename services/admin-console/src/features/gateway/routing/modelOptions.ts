import type { SelectOption } from '@/shared/ui/FormFields';

import { hasModelCapability } from '../providers/api/modelCapabilities';
import type { ModelCapability, ProviderModelResponse, ProviderResponse } from '../providers/api/providerTypes';

export interface ModelSelectOptionsCriteria {
  /** Current values: kept and marked even when no longer selectable, so a choice is never silently hidden. */
  alwaysIncludeModelPks?: readonly (number | null | undefined)[];
  /** Only offer models declaring this capability (e.g. vision for tasks that require it). */
  requiredCapability?: ModelCapability | undefined;
}

function describeUnselectableReason(
  provider: ProviderResponse,
  model: ProviderModelResponse,
  requiredCapability: ModelCapability | undefined,
): string | null {
  if (!provider.is_enabled || !model.is_enabled) return 'disabled';
  if (requiredCapability && !hasModelCapability(model, requiredCapability)) return `no ${requiredCapability}`;
  return null;
}

/**
 * Select options for models, labelled `provider_id/model_id`. Only enabled models of
 * enabled providers (with the required capability) are offered, plus the current values.
 */
export function buildModelSelectOptions(
  providers: readonly ProviderResponse[],
  { alwaysIncludeModelPks = [], requiredCapability }: ModelSelectOptionsCriteria = {},
): SelectOption[] {
  const options: SelectOption[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      const unselectableReason = describeUnselectableReason(provider, model, requiredCapability);
      if (unselectableReason !== null && !alwaysIncludeModelPks.includes(model.id)) continue;
      const labelSuffixes = [unselectableReason, model.is_available ? null : 'unavailable'].filter(Boolean);
      options.push({
        value: String(model.id),
        label: `${model.qualified_name}${labelSuffixes.length > 0 ? ` (${labelSuffixes.join(', ')})` : ''}`,
      });
    }
  }
  return options.sort((first, second) => first.label.localeCompare(second.label));
}
