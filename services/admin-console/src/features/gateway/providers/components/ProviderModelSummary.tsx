import { formatCompactNumber } from '@/shared/lib/format';
import { StatusBadge, Tag } from '@/shared/ui/StatusMessages';

import { VISION_CAPABILITY, hasModelCapability } from '../api/modelCapabilities';
import type { ProviderModelResponse } from '../api/providerTypes';

/** Name, badges and known token limits of a configured model. */
export function ProviderModelSummary({ model }: { model: ProviderModelResponse }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="font-mono text-sm wrap-break-word text-primary" title={model.qualified_name}>
          {model.model_id}
        </p>
        {hasModelCapability(model, VISION_CAPABILITY) ? <Tag>Vision</Tag> : null}
        {model.reasoning_control === 'enable_thinking' ? <Tag>Thinking switch</Tag> : null}
        {model.base_url_override !== null || model.api_protocol_override !== null ? <Tag>Custom endpoint</Tag> : null}
        {model.is_available ? null : (
          <span title="The serving machine reports this model as not loaded; requests to it will fail.">
            <StatusBadge tone="warning" label="Unavailable" />
          </span>
        )}
      </div>
      {model.display_name ? <p className="text-xs text-secondary">{model.display_name}</p> : null}
      {describeModelLimits(model) ? <p className="text-xs text-muted">{describeModelLimits(model)}</p> : null}
    </div>
  );
}

function describeModelLimits(model: ProviderModelResponse): string {
  const facts: string[] = [];
  if (model.context_window_tokens !== null) {
    facts.push(`context ${formatCompactNumber(model.context_window_tokens)} tokens`);
  }
  if (model.max_output_tokens !== null) {
    facts.push(`max output ${formatCompactNumber(model.max_output_tokens)}`);
  }
  if (model.default_max_output_tokens !== null) {
    facts.push(`default output ${formatCompactNumber(model.default_max_output_tokens)}`);
  }
  return facts.join(' · ');
}
