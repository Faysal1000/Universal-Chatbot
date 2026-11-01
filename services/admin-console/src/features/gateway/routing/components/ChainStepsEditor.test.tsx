import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { MAX_CHAIN_STEPS } from '../api/routingTypes';
import { NO_CHAIN_ERRORS, createChainStep } from '../chainFormModel';
import type { ChainStepValues } from '../chainFormModel';
import { ChainStepsEditor } from './ChainStepsEditor';

const MODEL_OPTIONS = [
  { value: '1', label: 'openai/gpt-5-mini' },
  { value: '2', label: 'local/qwen3-8b' },
];

function EditorHarness({ initialStepCount }: { initialStepCount: number }) {
  const [steps, setSteps] = useState<ChainStepValues[]>(() =>
    Array.from({ length: initialStepCount }, () => createChainStep()),
  );
  return <ChainStepsEditor steps={steps} modelOptions={MODEL_OPTIONS} errors={NO_CHAIN_ERRORS} onChange={setSteps} />;
}

describe('ChainStepsEditor', () => {
  it('labels each row and its drag handle by position', () => {
    render(<EditorHarness initialStepCount={2} />);
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Step 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder step 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder step 2' })).toBeInTheDocument();
  });

  it('keeps the only step', () => {
    render(<EditorHarness initialStepCount={1} />);
    expect(screen.getByRole('button', { name: 'Remove step 1' })).toBeDisabled();
  });

  it('adds steps up to the limit', async () => {
    render(<EditorHarness initialStepCount={MAX_CHAIN_STEPS - 1} />);
    const addButton = screen.getByRole('button', { name: 'Add step' });
    await userEvent.click(addButton);
    expect(screen.getByText(`Step ${MAX_CHAIN_STEPS}`)).toBeInTheDocument();
    expect(addButton).toBeDisabled();
  });

  it('removes a step and renumbers the rest', async () => {
    render(<EditorHarness initialStepCount={3} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove step 2' }));
    expect(screen.queryByText('Step 3')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder step 2' })).toBeInTheDocument();
  });
});
