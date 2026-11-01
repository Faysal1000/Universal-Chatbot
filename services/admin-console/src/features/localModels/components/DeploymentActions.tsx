import { Button } from '@/shared/ui/Button';

import type { Deployment } from '../api/localModelTypes';
import { availableDeploymentActions } from '../deploymentStatusModel';

export interface DeploymentActionHandlers {
  onLoad: (deployment: Deployment) => void;
  onUnload: (deployment: Deployment) => void;
  onRestart: (deployment: Deployment) => void;
  onRemove: (deployment: Deployment) => void;
  onEdit: (deployment: Deployment) => void;
}

/**
 * The row's buttons: Load, Restart, Unload, Edit and Remove. Unload and Remove are never offered
 * for the system deployment; Edit is disabled while a load or swap is under way.
 */
export function DeploymentActions({
  deployment,
  isBusy,
  onLoad,
  onUnload,
  onRestart,
  onRemove,
  onEdit,
}: DeploymentActionHandlers & { deployment: Deployment; isBusy: boolean }) {
  const actions = availableDeploymentActions(deployment);
  return (
    <div className="flex justify-end gap-1">
      {actions.has('load') ? (
        <Button size="small" isLoading={isBusy} onClick={() => onLoad(deployment)}>
          Load
        </Button>
      ) : null}
      {actions.has('restart') ? (
        <Button size="small" variant="ghost" disabled={isBusy} onClick={() => onRestart(deployment)}>
          Restart
        </Button>
      ) : null}
      {actions.has('unload') ? (
        <Button size="small" variant="ghost" disabled={isBusy} onClick={() => onUnload(deployment)}>
          Unload
        </Button>
      ) : null}
      <Button
        size="small"
        variant="ghost"
        disabled={!actions.has('edit')}
        title={actions.has('edit') ? undefined : 'Settings can change once loading finishes.'}
        onClick={() => onEdit(deployment)}
      >
        Edit
      </Button>
      {actions.has('remove') ? (
        <Button size="small" variant="ghost" className="text-critical-text" onClick={() => onRemove(deployment)}>
          Remove
        </Button>
      ) : null}
    </div>
  );
}
