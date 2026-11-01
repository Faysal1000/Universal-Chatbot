import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { joinClassNames } from '@/shared/lib/classNames';
import { Button } from '@/shared/ui/Button';
import { HintButton } from '@/shared/ui/FormFields';
import { useHint } from '@/shared/ui/useHint';
import type { SelectOption } from '@/shared/ui/FormFields';

import { MAX_CHAIN_STEPS } from '../api/routingTypes';
import { CHAIN_DRAG_INSTRUCTIONS, buildChainDragAnnouncements } from '../chainDragAnnouncements';
import {
  addChainStep,
  canAddChainStep,
  canRemoveChainStep,
  removeChainStep,
  reorderChainSteps,
  updateChainStep,
} from '../chainFormModel';
import type { ChainStepValues, ChainValidationErrors } from '../chainFormModel';
import { CHAIN_STEP_GRID_CLASS_NAME, ChainStepRow } from './ChainStepRow';

/** A pointer must travel this far before a press on the handle becomes a drag. */
const POINTER_DRAG_THRESHOLD_PIXELS = 4;

export interface ChainStepsEditorProps {
  steps: readonly ChainStepValues[];
  modelOptions: readonly SelectOption[];
  errors: ChainValidationErrors;
  onChange: (steps: ChainStepValues[]) => void;
}

/** Ordered, drag-sortable list of chain steps; the gateway tries them top to bottom. */
export function ChainStepsEditor({ steps, modelOptions, errors, onChange }: ChainStepsEditorProps) {
  // Announcements live inside the editor so they stay audible inside a modal dialog (the rest of the page is inert).
  const [announcementContainer, setAnnouncementContainer] = useState<HTMLElement | null>(null);
  const chainHint = useHint();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: POINTER_DRAG_THRESHOLD_PIXELS } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const modelLabelsByPk = new Map(modelOptions.map((option) => [option.value, option.label]));
  const isFull = !canAddChainStep(steps);

  const moveDraggedStep = ({ active, over }: DragEndEvent) => {
    if (over) onChange(reorderChainSteps(steps, String(active.id), String(over.id)));
  };

  return (
    <fieldset ref={setAnnouncementContainer} className="flex flex-col gap-2">
      <legend className="mb-1 flex items-center gap-1 text-sm font-medium text-primary">
        Model chain
        <HintButton {...chainHint.buttonProps} />
      </legend>
      <p id={chainHint.id} className={chainHint.textClassName}>
        Tried top to bottom. Drag a handle, or focus it and use Space and the arrow keys. Empty attempts and timeout use
        the defaults.
      </p>
      <div
        aria-hidden="true"
        className={joinClassNames('hidden px-2 text-xs font-medium text-muted', CHAIN_STEP_GRID_CLASS_NAME)}
      >
        <span className="col-span-2">Order</span>
        <span>Model</span>
        <span>Attempts</span>
        <span>Timeout (s)</span>
        <span>Enabled</span>
        <span />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={moveDraggedStep}
        accessibility={{
          announcements: buildChainDragAnnouncements(steps, (modelPk) => modelLabelsByPk.get(modelPk) ?? ''),
          screenReaderInstructions: CHAIN_DRAG_INSTRUCTIONS,
          container: announcementContainer ?? undefined,
        }}
      >
        <SortableContext items={steps.map((step) => step.rowKey)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-1.5">
            {steps.map((step, index) => (
              <ChainStepRow
                key={step.rowKey}
                step={step}
                position={index + 1}
                modelOptions={modelOptions}
                errorMessage={errors.stepErrors[step.rowKey]}
                canRemove={canRemoveChainStep(steps)}
                onChange={(changes) => onChange(updateChainStep(steps, step.rowKey, changes))}
                onRemove={() => onChange(removeChainStep(steps, step.rowKey))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {errors.chainError ? (
        <p role="alert" className="text-xs text-critical-text">
          {errors.chainError}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          size="small"
          leadingIcon={<Plus aria-hidden="true" className="size-3.5" />}
          disabled={isFull}
          onClick={() => onChange(addChainStep(steps))}
        >
          Add step
        </Button>
        <span className="tabular text-xs text-muted">
          {steps.length} of {MAX_CHAIN_STEPS} steps{isFull ? ' (the most a chain can hold)' : ''}
        </span>
      </div>
    </fieldset>
  );
}
