import type { SelectOption } from '@/shared/ui/FormFields';
import { ErrorBanner, WarningBanner } from '@/shared/ui/StatusMessages';

import type { RouteChainDraft } from '../useRouteChainDraft';
import { AppendDefaultModelSwitch } from './AppendDefaultModelSwitch';
import { ChainStepsEditor } from './ChainStepsEditor';

export interface RouteChainFieldsProps {
  draft: RouteChainDraft;
  modelOptions: readonly SelectOption[];
  doesTaskRequireVision: boolean;
}

/** The chain part of a route form: model availability notice, sortable steps and the default-model switch. */
export function RouteChainFields({ draft, modelOptions, doesTaskRequireVision }: RouteChainFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      {modelOptions.length === 0 ? (
        <ErrorBanner
          message={
            doesTaskRequireVision
              ? 'This task requires vision, but no enabled model has the Vision capability. Mark one under Providers first.'
              : 'No enabled models exist yet. Add a provider and its models under Providers first.'
          }
        />
      ) : doesTaskRequireVision ? (
        <WarningBanner>This task requires vision, so only models with the Vision capability are offered.</WarningBanner>
      ) : null}
      <ChainStepsEditor
        steps={draft.steps}
        modelOptions={modelOptions}
        errors={draft.chainErrors}
        onChange={draft.setSteps}
      />
      <AppendDefaultModelSwitch
        isOn={draft.appendDefaultModel}
        onChange={draft.setAppendDefaultModel}
        steps={draft.steps}
      />
    </div>
  );
}
