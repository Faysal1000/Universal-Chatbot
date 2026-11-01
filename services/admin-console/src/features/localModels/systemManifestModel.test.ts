import { describe, expect, it } from 'vitest';

import type { SystemView } from './api/localModelTypes';
import { hasGpuBudget, systemManifestFields } from './systemManifestModel';

const GIBIBYTE = 1024 ** 3;

function aCpuOnlySystem(overrides: Partial<SystemView> = {}): SystemView {
  return {
    cpu_cores: 10,
    ram_capacity_bytes: 16 * GIBIBYTE,
    ram_available_bytes: 9 * GIBIBYTE,
    memory_reserve_bytes: 2 * GIBIBYTE,
    gpus: [],
    budgets: [
      { device: 'cpu', capacity_bytes: 14 * GIBIBYTE, reserved_bytes: 4 * GIBIBYTE, free_bytes: 10 * GIBIBYTE },
    ],
    engines: { transformers_cuda: false, llama_cpp_installed: true, llama_cpp_cuda: false },
    ...overrides,
  };
}

function fieldValue(system: SystemView, label: string) {
  return systemManifestFields(system).find((field) => field.label === label);
}

describe('systemManifestFields', () => {
  it('shows the CPU budget as used of capacity', () => {
    expect(fieldValue(aCpuOnlySystem(), 'CPU budget used')).toEqual({
      label: 'CPU budget used',
      value: '4 GB of 14 GB',
      note: '10 GB free, 2 GB held back',
    });
  });

  it('says there is no GPU on a CPU-only host', () => {
    expect(fieldValue(aCpuOnlySystem(), 'GPU')?.value).toBe('None');
    expect(fieldValue(aCpuOnlySystem(), 'GPUs')).toBeUndefined();
    expect(fieldValue(aCpuOnlySystem(), 'Engines')?.value).toBe('Transformers CPU');
    expect(hasGpuBudget(aCpuOnlySystem())).toBe(false);
  });

  it('shows the GPU budget and engines when a GPU is present', () => {
    const system = aCpuOnlySystem({
      gpus: [{ index: 0, name: 'NVIDIA L4', total_memory_bytes: 24 * GIBIBYTE, free_memory_bytes: 20 * GIBIBYTE }],
      budgets: [
        ...aCpuOnlySystem().budgets,
        { device: 'cuda', capacity_bytes: 22 * GIBIBYTE, reserved_bytes: 6 * GIBIBYTE, free_bytes: 16 * GIBIBYTE },
      ],
      engines: { transformers_cuda: true, llama_cpp_installed: true, llama_cpp_cuda: true },
    });
    expect(fieldValue(system, 'GPU budget used')?.value).toBe('6 GB of 22 GB');
    expect(fieldValue(system, 'GPUs')?.value).toBe('NVIDIA L4');
    expect(fieldValue(system, 'Engines')?.note).toBe('llama.cpp CPU + GPU');
    expect(hasGpuBudget(system)).toBe(true);
  });

  it('reports a missing llama.cpp binary', () => {
    const system = aCpuOnlySystem({
      engines: { transformers_cuda: false, llama_cpp_installed: false, llama_cpp_cuda: false },
    });
    expect(fieldValue(system, 'Engines')?.note).toBe('llama.cpp not installed');
  });
});
