import { Fragment, useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';
import { useToast } from '@/shared/ui/toastContext';

import { useProviders } from '../providers/api/providerQueries';
import type { ProviderResponse } from '../providers/api/providerTypes';
import { useDeleteTaskRoute, useTaskRoutes, useTasks, useUpdateTaskRoute } from './api/routingQueries';
import type { TaskResponse, TaskRouteResponse } from './api/routingTypes';
import { ChainSummary } from './components/ChainSummary';
import { CircuitBreakersCard } from './components/CircuitBreakersCard';
import { CreateTaskRouteDialog } from './components/CreateTaskRouteDialog';
import { DefaultModelCard } from './components/DefaultModelCard';
import { TaskRouteChainPanel } from './components/TaskRouteChainPanel';

const TASK_ROUTE_COLUMN_COUNT = 4;

export function RoutingPage() {
  const providersQuery = useProviders();
  const taskRoutesQuery = useTaskRoutes();
  const tasksQuery = useTasks();
  const [taskNameToRoute, setTaskNameToRoute] = useState<string | null>(null);
  const [editedTaskName, setEditedTaskName] = useState<string | null>(null);
  const [routePendingDeletion, setRoutePendingDeletion] = useState<TaskRouteResponse | null>(null);
  const deleteRouteMutation = useDeleteTaskRoute();
  const { showToast } = useToast();
  const providers = providersQuery.data ?? [];
  const routesByTaskName = new Map(taskRoutesQuery.data?.map((route) => [route.task_name, route]));
  const tasks = tasksQuery.data ?? [];
  const failedQuery = [taskRoutesQuery, tasksQuery].find((query) => query.isError);

  return (
    <>
      <PageHeader title="Routing" />
      {providersQuery.isError ? (
        <div className="mb-4">
          <ErrorBanner
            title="Could not load models"
            message={describeError(providersQuery.error)}
            onRetry={() => void providersQuery.refetch()}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <DefaultModelCard providers={providers} />

        <Card title="Tasks" bodyClassName="p-0">
          {taskRoutesQuery.isPending || tasksQuery.isPending ? (
            <LoadingState label="Loading tasks…" />
          ) : failedQuery ? (
            <div className="p-4">
              <ErrorBanner message={describeError(failedQuery.error)} onRetry={() => void failedQuery.refetch()} />
            </div>
          ) : (
            <Table caption="Tasks and their model chains" isStackedOnMobile>
              <thead>
                <tr>
                  <HeaderCell>Task</HeaderCell>
                  <HeaderCell>Model chain</HeaderCell>
                  <HeaderCell>Enabled</HeaderCell>
                  <HeaderCell>
                    <span className="sr-only">Actions</span>
                  </HeaderCell>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const route = routesByTaskName.get(task.task_name);
                  return route ? (
                    <TaskRouteRow
                      key={task.task_name}
                      task={task}
                      route={route}
                      providers={providers}
                      isEditing={editedTaskName === task.task_name}
                      onToggleEditing={() =>
                        setEditedTaskName((current) => (current === task.task_name ? null : task.task_name))
                      }
                      onCloseEditor={() => setEditedTaskName(null)}
                      onDelete={() => {
                        deleteRouteMutation.reset();
                        setRoutePendingDeletion(route);
                      }}
                    />
                  ) : (
                    <UnroutedTaskRow
                      key={task.task_name}
                      task={task}
                      onCreateRoute={() => setTaskNameToRoute(task.task_name)}
                    />
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <CircuitBreakersCard />
      </div>

      <CreateTaskRouteDialog
        taskName={taskNameToRoute}
        onClose={() => setTaskNameToRoute(null)}
        providers={providers}
      />
      <ConfirmDialog
        isOpen={routePendingDeletion !== null}
        title={`Delete route “${routePendingDeletion?.task_name ?? ''}”?`}
        message={<p>Requests for this task will be served by the default model.</p>}
        confirmLabel="Delete route"
        isConfirming={deleteRouteMutation.isPending}
        errorMessage={deleteRouteMutation.isError ? describeError(deleteRouteMutation.error) : null}
        onConfirm={() => {
          if (!routePendingDeletion) return;
          const deletedTaskName = routePendingDeletion.task_name;
          deleteRouteMutation.mutate(deletedTaskName, {
            onSuccess: () => {
              setRoutePendingDeletion(null);
              showToast(`Route ${deletedTaskName} deleted.`, 'success');
            },
          });
        }}
        onCancel={() => setRoutePendingDeletion(null)}
      />
    </>
  );
}

function TaskNameCell({ task }: { task: TaskResponse }) {
  return (
    <DataCell className="max-sm:basis-full">
      <p className="font-mono font-medium text-primary">{task.task_name}</p>
      {task.description ? <p className="max-w-80 text-xs text-muted">{task.description}</p> : null}
    </DataCell>
  );
}

interface TaskRouteRowProps {
  task: TaskResponse;
  route: TaskRouteResponse;
  providers: readonly ProviderResponse[];
  isEditing: boolean;
  onToggleEditing: () => void;
  onCloseEditor: () => void;
  onDelete: () => void;
}

/** A route's summary row; while editing, its chain editor opens in a full-width row underneath. */
function TaskRouteRow({
  task,
  route,
  providers,
  isEditing,
  onToggleEditing,
  onCloseEditor,
  onDelete,
}: TaskRouteRowProps) {
  const updateRouteMutation = useUpdateTaskRoute();
  const { showToast } = useToast();
  return (
    <Fragment>
      <tr className={isEditing ? 'bg-surface-hover' : 'hover:bg-surface-hover'}>
        <TaskNameCell task={task} />
        <DataCell className="max-sm:basis-full">
          <ChainSummary route={route} />
        </DataCell>
        <DataCell>
          <ToggleSwitch
            isOn={route.is_enabled}
            disabled={updateRouteMutation.isPending}
            label={`Enable route ${route.task_name}`}
            isLabelVisuallyHidden
            onChange={(isEnabled) =>
              updateRouteMutation.mutate(
                { taskName: route.task_name, request: { is_enabled: isEnabled } },
                { onError: (error) => showToast(describeError(error), 'error') },
              )
            }
          />
        </DataCell>
        <DataCell className="text-right whitespace-nowrap max-sm:ml-auto">
          <Button size="small" variant="ghost" aria-expanded={isEditing} onClick={onToggleEditing}>
            {isEditing ? 'Close editor' : 'Edit chain'}
          </Button>
          <Button size="small" variant="ghost" className="text-critical-text" onClick={onDelete}>
            Delete
          </Button>
        </DataCell>
      </tr>
      {isEditing ? (
        <tr>
          <td colSpan={TASK_ROUTE_COLUMN_COUNT} className="border-b border-border p-3 max-sm:basis-full">
            <TaskRouteChainPanel route={route} providers={providers} onClose={onCloseEditor} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

interface UnroutedTaskRowProps {
  task: TaskResponse;
  onCreateRoute: () => void;
}

/** A task without a route: the default model serves it until a route is created. */
function UnroutedTaskRow({ task, onCreateRoute }: UnroutedTaskRowProps) {
  return (
    <tr className="hover:bg-surface-hover">
      <TaskNameCell task={task} />
      <DataCell className="text-muted">Default model</DataCell>
      <DataCell className="text-muted max-sm:hidden">—</DataCell>
      <DataCell className="text-right whitespace-nowrap max-sm:ml-auto">
        <Button size="small" variant="ghost" onClick={onCreateRoute}>
          Create route
        </Button>
      </DataCell>
    </tr>
  );
}
