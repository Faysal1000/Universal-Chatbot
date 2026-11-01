import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';
import { useToast } from '@/shared/ui/toastContext';

import type { ProviderResponse } from '../../providers/api/providerTypes';
import { useCreateTaskRoute } from '../api/routingQueries';
import { useRouteChainDraft } from '../useRouteChainDraft';
import { useTaskRouteModelOptions } from '../useTaskRouteModelOptions';
import { RouteChainFields } from './RouteChainFields';

export interface CreateTaskRouteDialogProps {
  /** The built-in task getting its first route; `null` keeps the dialog closed. */
  taskName: string | null;
  onClose: () => void;
  providers: readonly ProviderResponse[];
}

/** Dialog wrapper; the form re-mounts for each open so it starts from fresh values. */
export function CreateTaskRouteDialog({ taskName, onClose, providers }: CreateTaskRouteDialogProps) {
  return (
    <Dialog isOpen={taskName !== null} onClose={onClose} width="large" title={`Route ${taskName ?? ''}`}>
      {taskName !== null ? <CreateTaskRouteForm taskName={taskName} onClose={onClose} providers={providers} /> : null}
    </Dialog>
  );
}

interface CreateTaskRouteFormProps {
  taskName: string;
  onClose: () => void;
  providers: readonly ProviderResponse[];
}

function CreateTaskRouteForm({ taskName, onClose, providers }: CreateTaskRouteFormProps) {
  const { showToast } = useToast();
  const createRouteMutation = useCreateTaskRoute();
  const draft = useRouteChainDraft(undefined);
  const [isEnabled, setIsEnabled] = useState(true);
  const [generalErrorMessage, setGeneralErrorMessage] = useState<string | null>(null);
  const { modelOptions, doesTaskRequireVision, isModelAllowedForTask } = useTaskRouteModelOptions(
    providers,
    taskName,
    undefined,
  );

  const showCreateError = (error: unknown) => {
    const isChainError = draft.showServerErrors(error);
    setGeneralErrorMessage(isChainError ? null : describeError(error));
  };

  const handleSubmit = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setGeneralErrorMessage(null);
    if (!draft.validate(isModelAllowedForTask)) return;
    createRouteMutation.mutate(
      { task_name: taskName, is_enabled: isEnabled, ...draft.toRequest() },
      {
        onSuccess: (createdRoute) => {
          showToast(`Route ${createdRoute.task_name} created.`, 'success');
          onClose();
        },
        onError: showCreateError,
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {generalErrorMessage ? <ErrorBanner message={generalErrorMessage} /> : null}
      <RouteChainFields draft={draft} modelOptions={modelOptions} doesTaskRequireVision={doesTaskRequireVision} />
      <ToggleSwitch isOn={isEnabled} onChange={setIsEnabled} label="Route enabled" />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" isLoading={createRouteMutation.isPending}>
          Create route
        </Button>
      </div>
    </form>
  );
}
