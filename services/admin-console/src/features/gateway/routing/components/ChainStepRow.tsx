import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';

import { joinClassNames } from '@/shared/lib/classNames';
import { Button } from '@/shared/ui/Button';
import { SelectField, TextField } from '@/shared/ui/FormFields';
import type { SelectOption } from '@/shared/ui/FormFields';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';

import type { ChainStepValues } from '../chainFormModel';

/** Column layout shared by the step rows and their heading row, so the columns line up. */
export const CHAIN_STEP_GRID_CLASS_NAME =
  'sm:grid sm:grid-cols-[2rem_3.5rem_minmax(10rem,1fr)_5.5rem_6.5rem_3.5rem_2rem] sm:items-center sm:gap-2';

export interface ChainStepRowProps {
  step: ChainStepValues;
  position: number;
  modelOptions: readonly SelectOption[];
  errorMessage: string | undefined;
  canRemove: boolean;
  onChange: (changes: Partial<Omit<ChainStepValues, 'rowKey'>>) => void;
  onRemove: () => void;
}

/** One sortable chain step: drag handle, model, attempts, timeout, enable switch and remove. */
export function ChainStepRow({
  step,
  position,
  modelOptions,
  errorMessage,
  canRemove,
  onChange,
  onRemove,
}: ChainStepRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: step.rowKey,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={joinClassNames(
        'relative rounded border bg-surface-raised px-2 py-2',
        isDragging ? 'z-10 border-accent' : 'border-border',
        !step.isEnabled && 'bg-surface',
      )}
    >
      <div className={joinClassNames('flex flex-wrap items-center gap-2', CHAIN_STEP_GRID_CLASS_NAME)}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder step ${position}`}
          className="inline-flex size-8 cursor-grab touch-none items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-primary active:cursor-grabbing"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
        <span className={joinClassNames('tabular text-xs font-medium', step.isEnabled ? 'text-primary' : 'text-muted')}>
          Step {position}
        </span>
        <SelectField
          className="min-w-48 flex-1"
          label={`Step ${position} model`}
          isLabelVisuallyHidden
          value={step.modelPk}
          onChange={(changeEvent) => onChange({ modelPk: changeEvent.target.value })}
          options={[{ value: '', label: 'Choose a model…', disabled: true }, ...modelOptions]}
        />
        <TextField
          className="w-22 sm:w-auto"
          label={`Step ${position} attempts`}
          isLabelVisuallyHidden
          inputMode="numeric"
          value={step.maxAttempts}
          placeholder="Default"
          onChange={(changeEvent) => onChange({ maxAttempts: changeEvent.target.value })}
        />
        <TextField
          className="w-26 sm:w-auto"
          label={`Step ${position} timeout in seconds`}
          isLabelVisuallyHidden
          inputMode="decimal"
          value={step.timeoutSeconds}
          placeholder="Provider"
          onChange={(changeEvent) => onChange({ timeoutSeconds: changeEvent.target.value })}
        />
        <ToggleSwitch
          isOn={step.isEnabled}
          onChange={(isEnabled) => onChange({ isEnabled })}
          label={`Enable step ${position}`}
          isLabelVisuallyHidden
        />
        <Button
          size="small"
          variant="ghost"
          className="w-8 px-0 hover:text-critical-text"
          disabled={!canRemove}
          aria-label={`Remove step ${position}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {errorMessage ? (
        <p role="alert" className="mt-1.5 text-xs text-critical-text sm:pl-[6rem]">
          {errorMessage}
        </p>
      ) : null}
    </li>
  );
}
