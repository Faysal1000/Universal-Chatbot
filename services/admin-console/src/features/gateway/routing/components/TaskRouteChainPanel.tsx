import { useEffect, useId, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { TextAreaField } from '@/shared/ui/FormFields';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import type { ProviderResponse } from '../../providers/api/providerTypes';
import { useReplaceTaskRouteChain, useUpdateTaskRoute } from '../api/routingQueries';
import type { TaskRouteResponse } from '../api/routingTypes';
import { useRouteChainDraft } from '../useRouteChainDraft';
import { useTaskRouteModelOptions } from '../useTaskRouteModelOptions';
import { RouteChainFields } from './RouteChainFields';

export interface TaskRouteChainPanelProps {
  route: TaskRouteResponse;
  providers: readonly ProviderResponse[];
  onClose: () => void;
}

/**
 * Inline editor for an existing route, opened under its table row so the other routes stay in view.
 * Saving replaces the whole chain (`PUT /routes/{task}/chain`), then the description if it changed.
 */
export function TaskRouteChainPanel({ route, providers, onClose }: TaskRouteChainPanelProps) {
  const { showToast } = useToast();
  const replaceChainMutation = useReplaceTaskRouteChain();
  const updateRouteMutation = useUpdateTaskRoute();
  const draft = useRouteChainDraft(route);
  const [description, setDescription] = useState(route.description ?? '');
  const [generalErrorMessage, setGeneralErrorMessage] = useState<string | null>(null);
  const { modelOptions, doesTaskRequireVision, isModelAllowedForTask } = useTaskRouteModelOptions(
    providers,
    route.task_name,
    route,
  );
  const headingId = useId();
  const headingReference = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingReference.current?.focus(), []);

  const showSaveError = (error: unknown) => {
    if (!draft.showServerErrors(error)) setGeneralErrorMessage(describeError(error));
  };

  const finishSaving = () => {
    showToast(`Route ${route.task_name} saved.`, 'success');
    onClose();
  };

  const saveDescriptionIfChanged = () => {
    const trimmedDescription = description.trim() || null;
    if (trimmedDescription === route.description) {
      finishSaving();
      return;
    }
    updateRouteMutation.mutate(
      { taskName: route.task_name, request: { description: trimmedDescription } },
      { onSuccess: finishSaving, onError: showSaveError },
    );
  };

  const handleSubmit = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setGeneralErrorMessage(null);
    if (!draft.validate(isModelAllowedForTask)) return;
    replaceChainMutation.mutate(
      { taskName: route.task_name, request: draft.toRequest() },
      { onSuccess: saveDescriptionIfChanged, onError: showSaveError },
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-md border border-border-strong bg-page p-4"
    >
      <h3 id={headingId} ref={headingReference} tabIndex={-1} className="text-sm font-semibold text-primary">
        Edit route <span className="font-mono">{route.task_name}</span>
      </h3>
      {generalErrorMessage ? <ErrorBanner message={generalErrorMessage} /> : null}
      <TextAreaField
        className="max-w-2xl"
        label="Description"
        value={description}
        maxLength={500}
        rows={2}
        onChange={(changeEvent) => setDescription(changeEvent.target.value)}
        placeholder="Optional: what this task is used for"
      />
      <RouteChainFields draft={draft} modelOptions={modelOptions} doesTaskRequireVision={doesTaskRequireVision} />
      <div className="flex gap-2 border-t border-border pt-3">
        <Button
          type="submit"
          variant="primary"
          isLoading={replaceChainMutation.isPending || updateRouteMutation.isPending}
        >
          Save chain
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
