import type { ReactNode } from 'react';

import { formatBytes, formatInteger, formatShortDateTime } from '@/shared/lib/format';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { Tag } from '@/shared/ui/StatusMessages';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { Deployment } from '../api/localModelTypes';
import { settingResolutions } from '../deploymentSettingsModel';
import {
  SYSTEM_DEPLOYMENT_LABEL,
  engineLabel,
  sortSystemDeploymentFirst,
  statusPlacardFor,
  throughputLines,
} from '../deploymentStatusModel';
import { DeploymentActions } from './DeploymentActions';
import type { DeploymentActionHandlers } from './DeploymentActions';

const SHORT_COMMIT_LENGTH = 8;

export interface DeploymentsTableProps extends DeploymentActionHandlers {
  deployments: readonly Deployment[];
  /** Name of the deployment whose command is being sent, to show a spinner on its row. */
  busyDeploymentName: string | undefined;
}

/** Every deployment with its status, device, memory and speed; the system deployment comes first. */
export function DeploymentsTable({ deployments, busyDeploymentName, ...actionHandlers }: DeploymentsTableProps) {
  return (
    <Table caption="Local model deployments">
      <thead>
        <tr>
          <HeaderCell>Deployment</HeaderCell>
          <HeaderCell>Hugging Face model</HeaderCell>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell>Runtime</HeaderCell>
          <HeaderCell>Configured → resolved</HeaderCell>
          <HeaderCell isNumeric>Memory</HeaderCell>
          <HeaderCell isNumeric>Throughput</HeaderCell>
          <HeaderCell isNumeric>Requests</HeaderCell>
          <HeaderCell>Loaded</HeaderCell>
          <HeaderCell>
            <span className="sr-only">Actions</span>
          </HeaderCell>
        </tr>
      </thead>
      <tbody>
        {sortSystemDeploymentFirst(deployments).map((deployment) => (
          <tr key={deployment.name} className="align-top hover:bg-surface-hover">
            <DeploymentNameCell deployment={deployment} />
            <ModelCell deployment={deployment} />
            <StatusCell deployment={deployment} />
            <RuntimeCell deployment={deployment} />
            <SettingsCell deployment={deployment} />
            <MemoryCell deployment={deployment} />
            <StackedCell isNumeric lines={throughputLines(deployment)} />
            <StackedCell
              isNumeric
              lines={[
                `${formatInteger(deployment.requests_in_flight)} in flight`,
                `${formatInteger(deployment.requests_queued)} queued`,
              ]}
            />
            <DataCell className="tabular whitespace-nowrap">{formatShortDateTime(deployment.loaded_at)}</DataCell>
            <DataCell className="text-right whitespace-nowrap">
              <DeploymentActions
                deployment={deployment}
                isBusy={busyDeploymentName === deployment.name}
                {...actionHandlers}
              />
            </DataCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function DeploymentNameCell({ deployment }: { deployment: Deployment }) {
  return (
    <DataCell className="min-w-44">
      <p className="font-mono font-medium text-primary">{deployment.name}</p>
      {deployment.display_name ? <p className="text-xs text-muted">{deployment.display_name}</p> : null}
      {deployment.is_system ? (
        <p className="mt-1">
          <Tag>{SYSTEM_DEPLOYMENT_LABEL}</Tag>
        </p>
      ) : null}
    </DataCell>
  );
}

function ModelCell({ deployment }: { deployment: Deployment }) {
  const loadedCommit = deployment.resolved_revision?.slice(0, SHORT_COMMIT_LENGTH);
  return (
    <DataCell className="min-w-48">
      <p className="font-mono text-xs break-all text-primary">{deployment.model_id}</p>
      <p className="text-xs text-muted">
        {deployment.revision ?? 'main'}
        {loadedCommit ? <span className="font-mono"> · {loadedCommit}</span> : null}
      </p>
    </DataCell>
  );
}

function StatusCell({ deployment }: { deployment: Deployment }) {
  const placard = statusPlacardFor(deployment.status);
  return (
    <DataCell className="max-w-72">
      <StatePlacard state={placard.state} label={placard.label} />
      {deployment.pending_update ? <p className="mt-1 text-xs text-muted">{deployment.pending_update}</p> : null}
      {deployment.status === 'failed' && deployment.last_error ? (
        <p className="mt-1 text-xs break-words text-critical-text">{deployment.last_error}</p>
      ) : null}
      <p className="tabular mt-1 text-xs whitespace-nowrap text-muted">
        since {formatShortDateTime(deployment.status_changed_at)}
      </p>
    </DataCell>
  );
}

function RuntimeCell({ deployment }: { deployment: Deployment }) {
  return (
    <DataCell className="whitespace-nowrap">
      <p className="text-primary">
        {engineLabel(deployment.engine)}
        {deployment.dtype ? <span className="text-muted"> · {deployment.dtype}</span> : null}
      </p>
      {deployment.capabilities.length > 0 ? (
        <p className="mt-1 flex gap-1">
          {deployment.capabilities.map((capability) => (
            <Tag key={capability}>{capability}</Tag>
          ))}
        </p>
      ) : null}
    </DataCell>
  );
}

/** Each setting as the admin set it and as local-llm resolved it, e.g. "Device  Auto → CPU". */
function SettingsCell({ deployment }: { deployment: Deployment }) {
  return (
    <DataCell className="whitespace-nowrap">
      <dl className="grid grid-cols-[auto_auto] gap-x-3 text-xs">
        {settingResolutions(deployment).map(({ label, configured, resolved }) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular text-primary">
              {configured === resolved ? (
                resolved
              ) : (
                <>
                  <span className="text-muted">{configured}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> resolved to </span>
                  {resolved}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </DataCell>
  );
}

function MemoryCell({ deployment }: { deployment: Deployment }) {
  const { memory } = deployment;
  return (
    <StackedCell
      isNumeric
      lines={[
        `${formatBytes(memory.estimated_bytes)} est.`,
        `${formatBytes(memory.reserved_bytes)} reserved`,
        `${formatBytes(memory.measured_bytes)} measured`,
      ]}
    />
  );
}

function StackedCell({ lines, isNumeric = false }: { lines: readonly ReactNode[]; isNumeric?: boolean }) {
  return (
    <DataCell isNumeric={isNumeric} className="whitespace-nowrap">
      {lines.map((line, lineIndex) => (
        <p key={lineIndex} className={lineIndex === 0 ? 'text-primary' : 'text-xs text-muted'}>
          {line}
        </p>
      ))}
    </DataCell>
  );
}
