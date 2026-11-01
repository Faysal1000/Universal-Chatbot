import type { Announcements, ScreenReaderInstructions, UniqueIdentifier } from '@dnd-kit/core';

import { chainStepPosition } from './chainFormModel';
import type { ChainStepValues } from './chainFormModel';

export const CHAIN_DRAG_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'To reorder a step, press space on its reorder handle to lift it, use the up and down arrow keys to move it, ' +
    'then press space again to drop it, or escape to cancel.',
};

/**
 * What screen readers hear while a step is dragged. `describeModel` turns a model key into its name
 * (empty when no model is chosen yet).
 */
export function buildChainDragAnnouncements(
  steps: readonly ChainStepValues[],
  describeModel: (modelPk: string) => string,
): Announcements {
  const stepCount = steps.length;
  const positionOf = (identifier: UniqueIdentifier) => chainStepPosition(steps, String(identifier)) ?? 0;
  const describeStep = (identifier: UniqueIdentifier) => {
    const modelName = describeModel(steps.find((step) => step.rowKey === String(identifier))?.modelPk ?? '');
    const position = positionOf(identifier);
    return modelName ? `Step ${position} (${modelName})` : `Step ${position}`;
  };

  return {
    onDragStart: ({ active }) =>
      `Picked up ${describeStep(active.id)}. Use the up and down arrow keys to move it, space to drop it, escape to cancel.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${describeStep(active.id)} is over position ${positionOf(over.id)} of ${stepCount}.`
        : `${describeStep(active.id)} is not over a position.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${describeStep(active.id)} dropped at position ${positionOf(over.id)} of ${stepCount}.`
        : `${describeStep(active.id)} dropped. The order did not change.`,
    onDragCancel: ({ active }) =>
      `Reordering cancelled. ${describeStep(active.id)} stays at position ${positionOf(active.id)}.`,
  };
}
