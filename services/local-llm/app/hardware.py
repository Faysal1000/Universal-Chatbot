"""Host inventory: RAM (cgroup-aware), usable CPU cores and CUDA GPUs.

Containers see the host's ``/proc/meminfo``, so the cgroup limit is checked first;
otherwise a model sized against host RAM could be OOM-killed by its container limit.
"""

import os
from dataclasses import dataclass
from pathlib import Path

import psutil
import torch

CGROUP_V2_ROOT = Path("/sys/fs/cgroup")
CGROUP_V1_MEMORY_LIMIT = Path("/sys/fs/cgroup/memory/memory.limit_in_bytes")
CGROUP_V1_MEMORY_USAGE = Path("/sys/fs/cgroup/memory/memory.usage_in_bytes")
# cgroup v1 reports "no limit" as a huge page-aligned number rather than "max".
CGROUP_V1_UNLIMITED_THRESHOLD = 1 << 60
LLAMA_CPP_CUDA_BACKEND_GLOB = "libggml-cuda*.so*"


@dataclass(frozen=True, slots=True)
class GpuInfo:
    """One CUDA device as PyTorch sees it."""

    index: int
    name: str
    total_memory_bytes: int
    free_memory_bytes: int


@dataclass(frozen=True, slots=True)
class HostInventory:
    """A snapshot of the compute resources visible to this process."""

    cpu_cores: int
    ram_capacity_bytes: int
    ram_available_bytes: int
    gpus: tuple[GpuInfo, ...]


def read_host_inventory(ram_capacity_override_bytes: int | None = None) -> HostInventory:
    """Take a fresh snapshot of CPU, RAM and GPUs."""
    return HostInventory(
        cpu_cores=usable_cpu_cores(),
        ram_capacity_bytes=ram_capacity_override_bytes or ram_capacity_bytes(),
        ram_available_bytes=ram_available_bytes(),
        gpus=tuple(list_cuda_gpus()),
    )


def usable_cpu_cores() -> int:
    """CPU cores this process may run on, honouring affinity and the cgroup CPU quota."""
    affinity_cores = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count() or 1
    quota_cores = _cgroup_cpu_quota_cores()
    return max(1, min(affinity_cores, quota_cores) if quota_cores else affinity_cores)


def default_inference_threads() -> int:
    """Physical cores within the usable set; hyper-threads and efficiency cores rarely speed up inference."""
    physical_cores = psutil.cpu_count(logical=False) or usable_cpu_cores()
    return max(1, min(physical_cores, usable_cpu_cores()))


def ram_capacity_bytes() -> int:
    """The container memory limit if one is set, otherwise physical RAM."""
    physical_ram = int(psutil.virtual_memory().total)
    cgroup_limit = _cgroup_memory_limit_bytes()
    return min(physical_ram, cgroup_limit) if cgroup_limit else physical_ram


def ram_available_bytes() -> int:
    """RAM that can still be allocated before hitting the container limit or host exhaustion."""
    host_available = int(psutil.virtual_memory().available)
    cgroup_limit = _cgroup_memory_limit_bytes()
    cgroup_usage = _cgroup_memory_usage_bytes()
    if cgroup_limit and cgroup_usage is not None:
        return max(0, min(host_available, cgroup_limit - cgroup_usage))
    return host_available


def list_cuda_gpus() -> list[GpuInfo]:
    """Every CUDA device with its current free memory; empty on CPU-only hosts and macOS."""
    if not torch.cuda.is_available():
        return []
    gpus = []
    for device_index in range(torch.cuda.device_count()):
        free_bytes, total_bytes = torch.cuda.mem_get_info(device_index)
        gpus.append(
            GpuInfo(
                index=device_index,
                name=torch.cuda.get_device_name(device_index),
                total_memory_bytes=int(total_bytes),
                free_memory_bytes=int(free_bytes),
            )
        )
    return gpus


def llama_cpp_supports_cuda(llama_server_binary: Path) -> bool:
    """True when the bundled llama.cpp build ships its CUDA backend next to the binary."""
    return any(llama_server_binary.parent.glob(LLAMA_CPP_CUDA_BACKEND_GLOB))


def process_tree_rss_bytes(process_id: int) -> int:
    """Resident memory of a process and its children (llama-server may fork helpers)."""
    try:
        process = psutil.Process(process_id)
        processes = [process, *process.children(recursive=True)]
        return sum(int(member.memory_info().rss) for member in processes)
    except psutil.Error:
        return 0


def _cgroup_memory_limit_bytes() -> int | None:
    v2_limit = _read_text(CGROUP_V2_ROOT / "memory.max")
    if v2_limit is not None:
        return None if v2_limit == "max" else int(v2_limit)
    v1_limit = _read_text(CGROUP_V1_MEMORY_LIMIT)
    if v1_limit is not None and int(v1_limit) < CGROUP_V1_UNLIMITED_THRESHOLD:
        return int(v1_limit)
    return None


def _cgroup_memory_usage_bytes() -> int | None:
    usage = _read_text(CGROUP_V2_ROOT / "memory.current") or _read_text(CGROUP_V1_MEMORY_USAGE)
    return int(usage) if usage is not None else None


def _cgroup_cpu_quota_cores() -> int | None:
    cpu_max = _read_text(CGROUP_V2_ROOT / "cpu.max")
    if cpu_max is None:
        return None
    quota, _, period = cpu_max.partition(" ")
    if quota == "max" or not period:
        return None
    return max(1, int(quota) // int(period))


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
