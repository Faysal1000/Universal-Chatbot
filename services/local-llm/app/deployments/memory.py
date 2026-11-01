"""Memory admission: estimate a model's footprint and reserve it on a device before loading.

Every loaded or loading deployment holds a reservation in the :class:`MemoryLedger`.
The system deployment's reservation is taken first at boot and kept while it reloads,
so an admin deployment can never take the memory Nemotron Parse needs.
"""

import threading
from collections.abc import Mapping
from dataclasses import dataclass

from app.config import DeviceRequest, ModelDtype
from app.deployments.models import EngineKind, ResolvedDevice, ResolvedModel, TorchDtypeName
from app.errors import GpuUnavailableError, InsufficientMemoryError

MEBIBYTE = 1024**2
BYTES_PER_PARAMETER: dict[TorchDtypeName, int] = {"bfloat16": 2, "float16": 2, "float32": 4}
# Conservative allowances on top of the weights; the measured footprint is reported after loading.
TRANSFORMERS_WEIGHT_OVERHEAD_RATIO = 0.20
GGUF_WEIGHT_OVERHEAD_RATIO = 0.05
RUNTIME_OVERHEAD_BYTES = 512 * MEBIBYTE
CONTEXT_BYTES_PER_TOKEN = 32 * 1024
DEVICE_PREFERENCE: dict[DeviceRequest, tuple[ResolvedDevice, ...]] = {
    "auto": ("cuda", "cpu"),
    "gpu": ("cuda",),
    "cpu": ("cpu",),
}


def resolve_dtype(requested_dtype: ModelDtype, device: ResolvedDevice) -> TorchDtypeName:
    """``auto`` is float32 on CPU (CPU bfloat16 kernels are many times slower) and bfloat16 on GPU."""
    if requested_dtype != "auto":
        return requested_dtype
    return "float32" if device == "cpu" else "bfloat16"


def estimate_required_bytes(resolved_model: ResolvedModel, dtype: TorchDtypeName, context_window_tokens: int) -> int:
    """Upper-bound memory needed to load the model and serve one request at this context size."""
    if resolved_model.engine == "llama_cpp":
        weight_bytes = resolved_model.weight_file_bytes * (1 + GGUF_WEIGHT_OVERHEAD_RATIO)
    else:
        weight_bytes = (
            resolved_model.parameter_count * BYTES_PER_PARAMETER[dtype] * (1 + TRANSFORMERS_WEIGHT_OVERHEAD_RATIO)
        )
    return int(weight_bytes + RUNTIME_OVERHEAD_BYTES + context_window_tokens * CONTEXT_BYTES_PER_TOKEN)


@dataclass(frozen=True, slots=True)
class MemoryReservation:
    """Memory held for one deployment (or one swap candidate) on one device."""

    device: ResolvedDevice
    reserved_bytes: int


class MemoryLedger:
    """Thread-safe accounting of memory reserved per device against fixed capacities."""

    def __init__(self, capacity_bytes_by_device: dict[ResolvedDevice, int]) -> None:
        self._capacity_bytes_by_device = dict(capacity_bytes_by_device)
        self._reservations: dict[str, MemoryReservation] = {}
        self._lock = threading.Lock()

    def capacity_bytes(self, device: ResolvedDevice) -> int:
        """Bytes this service may use on ``device`` (0 when the device does not exist)."""
        return self._capacity_bytes_by_device.get(device, 0)

    def free_bytes(self, device: ResolvedDevice) -> int:
        """Capacity not yet reserved on ``device``."""
        with self._lock:
            return self._free_bytes_unlocked(device)

    def reservation_of(self, owner: str) -> MemoryReservation | None:
        """The reservation held by ``owner``, if any."""
        with self._lock:
            return self._reservations.get(owner)

    def reserve(
        self,
        owner: str,
        device_request: DeviceRequest,
        required_bytes_by_device: Mapping[ResolvedDevice, int],
        usable_devices: frozenset[ResolvedDevice],
    ) -> MemoryReservation:
        """Reserve memory on the first preferred device that fits, or raise.

        The requirement is per device because the dtype (and so the size) depends on the device.

        An existing reservation of the same owner is replaced, so re-planning a deployment
        never counts its own memory against itself.
        """
        preferred_devices = [device for device in DEVICE_PREFERENCE[device_request] if device in usable_devices]
        if not preferred_devices:
            raise GpuUnavailableError()
        with self._lock:
            for device in preferred_devices:
                required_bytes = required_bytes_by_device[device]
                if self._free_bytes_unlocked(device, excluding_owner=owner) >= required_bytes:
                    reservation = MemoryReservation(device=device, reserved_bytes=required_bytes)
                    self._reservations[owner] = reservation
                    return reservation
            free_bytes_by_device = {
                device: self._free_bytes_unlocked(device, excluding_owner=owner) for device in preferred_devices
            }
        required_by_preferred_device = {device: required_bytes_by_device[device] for device in preferred_devices}
        raise InsufficientMemoryError(
            "Not enough memory: "
            + ", ".join(
                f"{device} needs about {required_by_preferred_device[device] // MEBIBYTE} MiB "
                f"and has {free // MEBIBYTE} MiB free"
                for device, free in free_bytes_by_device.items()
            ),
            details={"required_bytes": required_by_preferred_device, "free_bytes": free_bytes_by_device},
        )

    def rename(self, current_owner: str, new_owner: str) -> None:
        """Move a reservation to a new owner (a swap candidate becoming the live model)."""
        with self._lock:
            reservation = self._reservations.pop(current_owner, None)
            if reservation is not None:
                self._reservations[new_owner] = reservation

    def release(self, owner: str) -> None:
        """Drop ``owner``'s reservation; releasing twice is harmless."""
        with self._lock:
            self._reservations.pop(owner, None)

    def _free_bytes_unlocked(self, device: ResolvedDevice, excluding_owner: str | None = None) -> int:
        reserved_bytes = sum(
            reservation.reserved_bytes
            for owner, reservation in self._reservations.items()
            if reservation.device == device and owner != excluding_owner
        )
        return self.capacity_bytes(device) - reserved_bytes


def usable_devices_for_engine(
    engine: EngineKind, has_cuda_for_transformers: bool, has_cuda_for_llama_cpp: bool
) -> frozenset[ResolvedDevice]:
    """Devices an engine can run on in this image on this host."""
    has_cuda = has_cuda_for_transformers if engine == "transformers" else has_cuda_for_llama_cpp
    return frozenset({"cpu", "cuda"}) if has_cuda else frozenset({"cpu"})
