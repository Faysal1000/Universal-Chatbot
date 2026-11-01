/** The facts about the local-llm host shown in the manifest line at the top of the page. */
import { formatBytes, formatInteger } from '@/shared/lib/format';

import type { DeviceBudget, ResolvedDevice, SystemView } from './api/localModelTypes';

export interface SystemManifestField {
  label: string;
  value: string;
  note?: string;
}

export function systemManifestFields(system: SystemView): SystemManifestField[] {
  return [
    {
      label: 'CPU',
      value: `${formatInteger(system.cpu_cores)} cores`,
      note: `${formatBytes(system.ram_capacity_bytes)} RAM, ${formatBytes(system.ram_available_bytes)} available`,
    },
    cpuBudgetField(system),
    ...gpuFields(system),
    {
      label: 'Engines',
      value: `Transformers ${system.engines.transformers_cuda ? 'CPU + GPU' : 'CPU'}`,
      note: `llama.cpp ${llamaCppSupportLabel(system)}`,
    },
  ];
}

/** One field when the host has no GPU, otherwise its budget and inventory. */
function gpuFields(system: SystemView): SystemManifestField[] {
  if (!hasGpuBudget(system) && system.gpus.length === 0) {
    return [{ label: 'GPU', value: 'None', note: 'Deployments run on CPU' }];
  }
  return [gpuBudgetField(system), gpuInventoryField(system)];
}

/** True when admission control can place deployments on a GPU. */
export function hasGpuBudget(system: SystemView): boolean {
  return findBudget(system, 'cuda') !== undefined;
}

function findBudget(system: SystemView, device: ResolvedDevice): DeviceBudget | undefined {
  return system.budgets.find((budget) => budget.device === device);
}

function cpuBudgetField(system: SystemView): SystemManifestField {
  const cpuBudget = findBudget(system, 'cpu');
  if (!cpuBudget) return { label: 'CPU budget used', value: 'None' };
  return {
    label: 'CPU budget used',
    value: describeBudgetUse(cpuBudget),
    note: `${formatBytes(cpuBudget.free_bytes)} free, ${formatBytes(system.memory_reserve_bytes)} held back`,
  };
}

function gpuBudgetField(system: SystemView): SystemManifestField {
  const gpuBudget = findBudget(system, 'cuda');
  if (!gpuBudget) return { label: 'GPU budget used', value: 'No GPU', note: 'Deployments run on CPU' };
  return {
    label: 'GPU budget used',
    value: describeBudgetUse(gpuBudget),
    note: `${formatBytes(gpuBudget.free_bytes)} free`,
  };
}

/** "4.1 GB of 12 GB": reserved out of what admission control may hand out. */
function describeBudgetUse(budget: DeviceBudget): string {
  return `${formatBytes(budget.reserved_bytes)} of ${formatBytes(budget.capacity_bytes)}`;
}

function gpuInventoryField(system: SystemView): SystemManifestField {
  const [firstGpu, ...otherGpus] = system.gpus;
  if (!firstGpu) return { label: 'GPUs', value: 'None detected' };
  const otherGpuNote = otherGpus.length > 0 ? ` (+${otherGpus.length} more, budget uses the first)` : '';
  return {
    label: 'GPUs',
    value: firstGpu.name,
    note: `${formatBytes(firstGpu.total_memory_bytes)} VRAM, ${formatBytes(firstGpu.free_memory_bytes)} free${otherGpuNote}`,
  };
}

function llamaCppSupportLabel(system: SystemView): string {
  if (!system.engines.llama_cpp_installed) return 'not installed';
  return system.engines.llama_cpp_cuda ? 'CPU + GPU' : 'CPU';
}
