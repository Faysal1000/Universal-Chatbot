import { Plus } from 'lucide-react';
import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useDeploymentCommand, useDeployments, useRemoveDeployment, useSystem } from './api/localModelQueries';
import type { Deployment } from './api/localModelTypes';
import type { DeploymentCommand } from './api/localModelsApi';
import { DeploymentDialog } from './components/DeploymentDialog';
import { DeploymentsTable } from './components/DeploymentsTable';
import { SystemManifest } from './components/SystemManifest';
import { deploymentsRefetchIntervalMilliseconds, describeTransitions } from './deploymentStatusModel';
import { describeRefusal } from './refusalModel';
import { hasGpuBudget } from './systemManifestModel';

type DeploymentDialogState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; deployment: Deployment };

const COMMAND_STARTED_MESSAGES: Record<DeploymentCommand, (deploymentName: string) => string> = {
  load: (deploymentName) => `Loading ${deploymentName}.`,
  restart: (deploymentName) => `Restarting ${deploymentName}.`,
  unload: (deploymentName) => `${deploymentName} unloaded; its memory is free.`,
};

export function LocalModelsPage() {
  const deploymentsQuery = useDeployments();
  const systemQuery = useSystem(deploymentsRefetchIntervalMilliseconds(deploymentsQuery.data));
  const deploymentCommandMutation = useDeploymentCommand();
  const removeDeploymentMutation = useRemoveDeployment();
  const { showToast } = useToast();
  const [dialogState, setDialogState] = useState<DeploymentDialogState>({ mode: 'closed' });
  const [deploymentPendingUnload, setDeploymentPendingUnload] = useState<Deployment | null>(null);
  const [deploymentPendingRemoval, setDeploymentPendingRemoval] = useState<Deployment | null>(null);
  const isGpuAvailable = systemQuery.data ? hasGpuBudget(systemQuery.data) : undefined;

  const runCommand = (deployment: Deployment, command: DeploymentCommand, onDone?: () => void) => {
    deploymentCommandMutation.mutate(
      { deploymentName: deployment.name, command },
      {
        onSuccess: () => {
          onDone?.();
          showToast(COMMAND_STARTED_MESSAGES[command](deployment.name), 'success');
        },
        onError: (error) => {
          if (!onDone) showToast(describeRefusal(error).message, 'error');
        },
      },
    );
  };

  const openConfirmation = (deployment: Deployment, setPending: (deployment: Deployment) => void) => {
    deploymentCommandMutation.reset();
    removeDeploymentMutation.reset();
    setPending(deployment);
  };

  const confirmUnload = () => {
    if (deploymentPendingUnload) runCommand(deploymentPendingUnload, 'unload', () => setDeploymentPendingUnload(null));
  };

  const confirmRemoval = () => {
    if (!deploymentPendingRemoval) return;
    const removedDeploymentName = deploymentPendingRemoval.name;
    removeDeploymentMutation.mutate(removedDeploymentName, {
      onSuccess: () => {
        setDeploymentPendingRemoval(null);
        showToast(`${removedDeploymentName} removed.`, 'success');
      },
    });
  };

  const busyDeploymentName = deploymentCommandMutation.isPending
    ? deploymentCommandMutation.variables.deploymentName
    : undefined;

  return (
    <>
      <PageHeader
        title="Local models"
        actions={
          <Button
            variant="primary"
            leadingIcon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => setDialogState({ mode: 'create' })}
          >
            Deploy model
          </Button>
        }
      />
      <div className="flex flex-col gap-6">
        <SystemManifest systemQuery={systemQuery} />
        <Card title="Deployments" bodyClassName="p-0">
          {deploymentsQuery.isPending ? (
            <LoadingState label="Loading deployments…" />
          ) : deploymentsQuery.isError ? (
            <div className="p-4">
              <ErrorBanner
                message={describeError(deploymentsQuery.error)}
                onRetry={() => void deploymentsQuery.refetch()}
              />
            </div>
          ) : deploymentsQuery.data.length === 0 ? (
            <EmptyState title="No deployments" description="Nemotron Parse appears once local-llm starts." />
          ) : (
            <>
              <p className="sr-only" aria-live="polite">
                {describeTransitions(deploymentsQuery.data)}
              </p>
              <DeploymentsTable
                deployments={deploymentsQuery.data}
                busyDeploymentName={busyDeploymentName}
                onLoad={(deployment) => runCommand(deployment, 'load')}
                onRestart={(deployment) => runCommand(deployment, 'restart')}
                onUnload={(deployment) => openConfirmation(deployment, setDeploymentPendingUnload)}
                onRemove={(deployment) => openConfirmation(deployment, setDeploymentPendingRemoval)}
                onEdit={(deployment) => setDialogState({ mode: 'edit', deployment })}
              />
            </>
          )}
        </Card>
      </div>

      <DeploymentDialog
        isOpen={dialogState.mode !== 'closed'}
        onClose={() => setDialogState({ mode: 'closed' })}
        existingDeployment={dialogState.mode === 'edit' ? dialogState.deployment : undefined}
        isGpuAvailable={isGpuAvailable}
      />
      <ConfirmDialog
        isOpen={deploymentPendingUnload !== null}
        title={`Unload “${deploymentPendingUnload?.name ?? ''}”?`}
        message={
          <p>
            The model stops serving and its memory is freed. Its settings stay, and the gateway marks it unavailable
            until you load it again.
          </p>
        }
        confirmLabel="Unload model"
        isConfirming={deploymentCommandMutation.isPending}
        errorMessage={
          deploymentCommandMutation.isError ? describeRefusal(deploymentCommandMutation.error).message : null
        }
        onConfirm={confirmUnload}
        onCancel={() => setDeploymentPendingUnload(null)}
      />
      <ConfirmDialog
        isOpen={deploymentPendingRemoval !== null}
        title={`Remove “${deploymentPendingRemoval?.name ?? ''}”?`}
        message={
          <p>
            The model is unloaded and its settings are deleted. The gateway marks it unavailable, so routes that use it
            fall back to their next model, if they have one.
          </p>
        }
        confirmLabel="Remove deployment"
        isConfirming={removeDeploymentMutation.isPending}
        errorMessage={removeDeploymentMutation.isError ? describeRefusal(removeDeploymentMutation.error).message : null}
        onConfirm={confirmRemoval}
        onCancel={() => setDeploymentPendingRemoval(null)}
      />
    </>
  );
}
