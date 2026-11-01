import { useTasks } from '@/features/gateway/routing/api/routingQueries';
import { HintButton, TextField } from '@/shared/ui/FormFields';
import { useHint } from '@/shared/ui/useHint';

import { parseTaskNames, toggleTaskName } from '../deploymentFormModel';

const HELP_TEXT = 'Optional. Claims only tasks without a route.';

export interface DefaultTasksFieldProps {
  /** Comma-separated task names. */
  value: string;
  onChange: (value: string) => void;
  errorMessage: string | undefined;
}

/** Checkboxes for the gateway's task catalog; a comma-separated text field when the catalog cannot be read. */
export function DefaultTasksField({ value, onChange, errorMessage }: DefaultTasksFieldProps) {
  const tasksQuery = useTasks();
  if (!tasksQuery.isSuccess) {
    return (
      <TextField
        label="Default for tasks"
        value={value}
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
        placeholder="query_rewrite, summarisation"
        spellCheck={false}
        autoComplete="off"
        helpText={`${HELP_TEXT} Separate task names with commas.`}
        errorMessage={errorMessage}
      />
    );
  }
  const selectedTaskNames = parseTaskNames(value);
  const catalogTaskNames = new Set(tasksQuery.data.map((task) => task.task_name));
  const uncataloguedTaskNames = selectedTaskNames.filter((taskName) => !catalogTaskNames.has(taskName));
  const taskOptions = [
    ...tasksQuery.data.map((task) => ({ taskName: task.task_name, hasRoute: task.has_route })),
    ...uncataloguedTaskNames.map((taskName) => ({ taskName, hasRoute: false })),
  ].sort((first, second) => first.taskName.localeCompare(second.taskName));

  return (
    <TaskCheckboxGroup
      taskOptions={taskOptions}
      selectedTaskNames={selectedTaskNames}
      onToggle={(taskName) => onChange(toggleTaskName(value, taskName))}
      errorMessage={errorMessage}
    />
  );
}

interface TaskOption {
  taskName: string;
  hasRoute: boolean;
}

function TaskCheckboxGroup({
  taskOptions,
  selectedTaskNames,
  onToggle,
  errorMessage,
}: {
  taskOptions: readonly TaskOption[];
  selectedTaskNames: readonly string[];
  onToggle: (taskName: string) => void;
  errorMessage: string | undefined;
}) {
  const hint = useHint();
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={hint.id}>
      <legend className="mb-1.5 flex items-center gap-1 text-sm font-medium text-primary">
        Default for tasks
        <HintButton {...hint.buttonProps} />
      </legend>
      <div className="grid max-h-40 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto rounded border border-border p-2 sm:grid-cols-2">
        {taskOptions.map(({ taskName, hasRoute }) => (
          <label key={taskName} className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={selectedTaskNames.includes(taskName)}
              onChange={() => onToggle(taskName)}
              className="accent-accent"
            />
            <span className="font-mono text-primary">{taskName}</span>
            {hasRoute ? <span className="text-xs text-muted">has a route</span> : null}
          </label>
        ))}
      </div>
      <p id={hint.id} className={hint.textClassName}>
        {HELP_TEXT}
      </p>
      {errorMessage ? (
        <p className="text-xs text-critical-text" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </fieldset>
  );
}
