"""Owns every deployment: lifecycle, memory admission, model swaps, persistence and gateway sync.

Lifecycle operations on one deployment are serialised by its lock; slow work (downloading,
loading) runs in a background task so admin calls return at once with ``202``.
"""

import asyncio
import contextlib
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from app.admission import DeploymentAdmission
from app.config import Settings
from app.deployments.loader import ModelLoader
from app.deployments.memory import MemoryLedger, MemoryReservation, estimate_required_bytes, resolve_dtype
from app.deployments.model_source import ModelSourceResolver
from app.deployments.models import (
    DeploymentSpec,
    DeploymentStatus,
    EngineKind,
    ResolvedDevice,
    ResolvedModel,
    effective_reasoning_control,
)
from app.deployments.runtime import DeploymentRuntime, LoadedState, ManagedModel
from app.deployments.store import DeploymentStore
from app.errors import (
    DeploymentConflictError,
    DeploymentNameTakenError,
    DeploymentNotFoundError,
    LocalLlmError,
    SystemDeploymentProtectedError,
)
from app.gateway_registration import GatewayRegistrar, RegistrationPayload
from app.throughput import ThroughputTracker

logger = logging.getLogger(__name__)

DEFAULT_MAX_OUTPUT_TOKENS = 4096
SUPERVISOR_INTERVAL_SECONDS = 15
SYSTEM_RETRY_INTERVAL_SECONDS = 60
UNLOAD_DRAIN_TIMEOUT_SECONDS = 30
SWAP_CANDIDATE_SUFFIX = "#next"
MAX_ERROR_MESSAGE_LENGTH = 500
LOADING_STATUSES = frozenset({DeploymentStatus.DOWNLOADING, DeploymentStatus.LOADING})
ALL_DEVICES: tuple[ResolvedDevice, ...] = ("cpu", "cuda")
MODEL_FIELDS = frozenset({"model_id", "revision", "device", "dtype", "context_window_tokens", "max_output_tokens"})

UsableDevices = Callable[[EngineKind], frozenset[ResolvedDevice]]


class DeploymentManager:
    """The single owner of deployment state; routes call it, never the engines directly."""

    def __init__(
        self,
        settings: Settings,
        store: DeploymentStore,
        resolver: ModelSourceResolver,
        loader: ModelLoader,
        ledger: MemoryLedger,
        registrar: GatewayRegistrar,
        usable_devices: UsableDevices,
    ) -> None:
        self._settings = settings
        self._store = store
        self._resolver = resolver
        self._loader = loader
        self._ledger = ledger
        self._registrar = registrar
        self._usable_devices = usable_devices
        self._runtimes: dict[str, DeploymentRuntime] = {}
        self._registry_lock = asyncio.Lock()
        self._background_tasks: set[asyncio.Task[None]] = set()

    # ------------------------------------------------------------------ startup and shutdown

    async def start(self) -> None:
        """Restore deployments, start gateway sync, then load the system deployment and the rest."""
        stored_specs = {spec.name: spec for spec in self._store.load_all()}
        system_spec = self._system_spec(stored_specs.get(self._settings.system_deployment_name))
        admin_specs = [spec for name, spec in stored_specs.items() if name != system_spec.name]
        for spec in (system_spec, *admin_specs):
            self._runtimes[spec.name] = self._new_runtime(spec)
        self._persist()
        self._registrar.start(self.ready_deployment_names)
        self._spawn(self._load_on_boot(), "load-on-boot")
        self._spawn(self._supervise_forever(), "deployment-supervisor")

    async def shutdown(self, drain_timeout_seconds: float) -> None:
        """Stop background work, unload every model (letting requests drain) and tell the gateway."""
        for task in list(self._background_tasks):
            task.cancel()
        await asyncio.gather(*self._background_tasks, return_exceptions=True)
        for runtime in self._runtimes.values():
            self._registrar.mark_unavailable(runtime.name)
            await self._stop_model(runtime, drain_timeout_seconds)
        await self._registrar.stop(flush_timeout_seconds=5)

    # ------------------------------------------------------------------ queries

    def list_runtimes(self) -> list[DeploymentRuntime]:
        """Every deployment, system deployment first."""
        return sorted(self._runtimes.values(), key=lambda runtime: (not runtime.spec.is_system, runtime.name))

    def get_runtime(self, deployment_name: str) -> DeploymentRuntime:
        """The deployment called ``deployment_name``, or 404."""
        runtime = self._runtimes.get(deployment_name)
        if runtime is None:
            raise DeploymentNotFoundError(f"Deployment '{deployment_name}' does not exist")
        return runtime

    def ready_deployment_names(self) -> set[str]:
        """Names of deployments currently serving requests."""
        return {runtime.name for runtime in self._runtimes.values() if runtime.status is DeploymentStatus.READY}

    def reservation_of(self, deployment_name: str) -> MemoryReservation | None:
        """Memory currently held for a deployment."""
        return self._ledger.reservation_of(deployment_name)

    @property
    def system_runtime(self) -> DeploymentRuntime:
        """Nemotron Parse (or whatever the system deployment is configured to be)."""
        return self._runtimes[self._settings.system_deployment_name]

    # ------------------------------------------------------------------ admin operations

    async def create(self, spec: DeploymentSpec) -> DeploymentRuntime:
        """Validate, reserve memory and start loading a new admin deployment (refused if it cannot fit)."""
        async with self._registry_lock:
            if self._ledger.reservation_of(self._settings.system_deployment_name) is None:
                raise DeploymentConflictError(
                    "The system deployment has not reserved its memory yet; retry once it is loading or ready"
                )
            if spec.name in self._runtimes:
                raise DeploymentNameTakenError(f"A deployment named '{spec.name}' already exists")
            runtime = self._new_runtime(spec.model_copy(update={"is_system": False, "should_be_loaded": True}))
            plan, reservation = await self._plan(runtime.spec, owner=runtime.name)
            self._runtimes[runtime.name] = runtime
            self._persist()
        self._start_loading(runtime, plan, reservation)
        return runtime

    async def load(self, deployment_name: str) -> DeploymentRuntime:
        """Load an unloaded or failed deployment; a no-op if it is already loaded or loading."""
        runtime = self.get_runtime(deployment_name)
        async with runtime.lifecycle_lock:
            if runtime.status is DeploymentStatus.READY or runtime.status in LOADING_STATUSES:
                return runtime
            plan, reservation = await self._plan(runtime.spec, owner=runtime.name)
            runtime.spec = runtime.spec.model_copy(update={"should_be_loaded": True})
            self._persist()
            self._start_loading(runtime, plan, reservation)
        return runtime

    async def unload(self, deployment_name: str) -> DeploymentRuntime:
        """Free an admin deployment's memory; it stays configured and can be loaded again."""
        runtime = self._require_admin_deployment(deployment_name, "unloaded")
        async with runtime.lifecycle_lock:
            await self._stop_model(runtime, UNLOAD_DRAIN_TIMEOUT_SECONDS)
            runtime.spec = runtime.spec.model_copy(update={"should_be_loaded": False})
            self._persist()
        return runtime

    async def restart(self, deployment_name: str) -> DeploymentRuntime:
        """Unload and load again (allowed for the system deployment)."""
        runtime = self.get_runtime(deployment_name)
        async with runtime.lifecycle_lock:
            # Keeping the reservation while stopping means nothing else can claim the memory meanwhile.
            await self._stop_model(runtime, UNLOAD_DRAIN_TIMEOUT_SECONDS, keep_reservation=True)
            plan, reservation = await self._plan(runtime.spec, owner=runtime.name)
            self._start_loading(runtime, plan, reservation)
        return runtime

    async def update(self, deployment_name: str, changes: dict[str, Any]) -> DeploymentRuntime:
        """Change settings; a new model or revision is swapped in while the old one keeps serving if memory allows."""
        runtime = self.get_runtime(deployment_name)
        async with runtime.lifecycle_lock:
            if runtime.status in LOADING_STATUSES or runtime.pending_update is not None:
                raise DeploymentConflictError(f"Deployment '{deployment_name}' is busy; retry when it is ready")
            new_spec = runtime.spec.model_copy(update=changes)
            if not MODEL_FIELDS.intersection(changes) or runtime.status is not DeploymentStatus.READY:
                self._apply_spec_change(runtime, new_spec)
                return runtime
            await self._start_swap(runtime, new_spec)
        return runtime

    async def delete(self, deployment_name: str) -> None:
        """Unload and forget an admin deployment."""
        runtime = self._require_admin_deployment(deployment_name, "removed")
        async with runtime.lifecycle_lock:
            await self._stop_model(runtime, UNLOAD_DRAIN_TIMEOUT_SECONDS)
            async with self._registry_lock:
                del self._runtimes[deployment_name]
                self._persist()

    # ------------------------------------------------------------------ planning and loading

    async def _plan(self, spec: DeploymentSpec, owner: str) -> tuple[LoadedState, MemoryReservation]:
        """Resolve the model on Hugging Face, size it per device, and reserve memory on the best device that fits."""
        resolved_model = await asyncio.to_thread(self._resolver.resolve, spec.model_id, spec.revision)
        default_context = self._settings.default_context_window_tokens
        context_window_tokens = spec.context_window_tokens or min(
            resolved_model.native_context_window_tokens or default_context, default_context
        )
        max_output_tokens = spec.max_output_tokens or min(DEFAULT_MAX_OUTPUT_TOKENS, context_window_tokens // 2)
        plans_by_device = {
            device: _plan_for_device(resolved_model, spec, device, context_window_tokens, max_output_tokens)
            for device in ALL_DEVICES
        }
        reservation = self._ledger.reserve(
            owner,
            spec.device,
            {device: plan.estimated_bytes for device, plan in plans_by_device.items()},
            self._usable_devices(resolved_model.engine),
        )
        return plans_by_device[reservation.device], reservation

    def _start_loading(self, runtime: DeploymentRuntime, plan: LoadedState, reservation: MemoryReservation) -> None:
        runtime.plan = plan
        runtime.change_status(DeploymentStatus.DOWNLOADING)
        runtime.lifecycle_task = self._spawn(self._load(runtime, plan, reservation), f"load-{runtime.name}")

    async def _load(self, runtime: DeploymentRuntime, plan: LoadedState, reservation: MemoryReservation) -> None:
        try:
            managed_model = await self._loader.load(runtime.name, plan, reservation.device, runtime.change_status)
        except Exception as error:  # noqa: BLE001 - any load failure must leave the deployment FAILED, not crash.
            self._record_load_failure(runtime, error)
            return
        self._mark_ready(runtime, managed_model, plan)

    def _mark_ready(self, runtime: DeploymentRuntime, managed_model: ManagedModel, plan: LoadedState) -> None:
        runtime.managed_model = managed_model
        runtime.plan = plan
        runtime.loaded_at = datetime.now(UTC)
        runtime.change_status(DeploymentStatus.READY)
        self._registrar.mark_available(runtime.name, self._registration_payload(runtime))
        logger.info(
            "Deployment ready",
            extra={
                "deployment": runtime.name,
                "model_id": runtime.spec.model_id,
                "device": managed_model.loaded_model.device,
            },
        )

    def _record_load_failure(self, runtime: DeploymentRuntime, error: Exception) -> None:
        logger.error("Deployment failed", extra={"deployment": runtime.name}, exc_info=error)
        runtime.change_status(DeploymentStatus.FAILED, _describe_error(error))
        # The system deployment keeps its memory so no admin deployment can take it before the retry.
        if not runtime.spec.is_system:
            self._ledger.release(runtime.name)
        self._registrar.mark_unavailable(runtime.name)

    async def _stop_model(
        self, runtime: DeploymentRuntime, drain_timeout_seconds: float, keep_reservation: bool = False
    ) -> None:
        """Cancel any load in progress, unload the model after in-flight requests finish, free memory."""
        if runtime.lifecycle_task is not None and not runtime.lifecycle_task.done():
            runtime.lifecycle_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await runtime.lifecycle_task
        managed_model, runtime.managed_model = runtime.managed_model, None
        if managed_model is not None:
            runtime.change_status(DeploymentStatus.UNLOADING)
            self._registrar.mark_unavailable(runtime.name)
            await managed_model.unload_when_idle(drain_timeout_seconds)
        if not keep_reservation:
            self._ledger.release(runtime.name)
        runtime.change_status(DeploymentStatus.UNLOADED)

    # ------------------------------------------------------------------ swaps (model or revision changes)

    async def _start_swap(self, runtime: DeploymentRuntime, new_spec: DeploymentSpec) -> None:
        """Load the new model next to the old one if it fits; otherwise replace it with a short gap."""
        candidate_owner = f"{runtime.name}{SWAP_CANDIDATE_SUFFIX}"
        try:
            plan, reservation = await self._plan(new_spec, owner=candidate_owner)
        except LocalLlmError as error:
            if error.error_code != "insufficient_memory":
                raise
            await self._replace_in_place(runtime, new_spec)
            return
        runtime.pending_update = f"loading {new_spec.model_id}"
        runtime.lifecycle_task = self._spawn(
            self._swap_side_by_side(runtime, new_spec, plan, reservation), f"swap-{runtime.name}"
        )

    async def _swap_side_by_side(
        self, runtime: DeploymentRuntime, new_spec: DeploymentSpec, plan: LoadedState, reservation: MemoryReservation
    ) -> None:
        candidate_owner = f"{runtime.name}{SWAP_CANDIDATE_SUFFIX}"
        try:
            new_model = await self._loader.load(
                runtime.name, plan, reservation.device, lambda status: _note_swap_progress(runtime, new_spec, status)
            )
        except asyncio.CancelledError:
            # Restarted or unloaded mid-swap: free the candidate's memory so later updates are not "busy".
            self._ledger.release(candidate_owner)
            runtime.pending_update = None
            raise
        except Exception as error:
            logger.exception("Model swap failed; the previous model keeps serving", extra={"deployment": runtime.name})
            self._ledger.release(candidate_owner)
            runtime.pending_update = None
            runtime.last_error = f"Update to {new_spec.model_id} failed: {_describe_error(error)}"
            return
        old_model = runtime.managed_model
        runtime.spec = new_spec
        runtime.pending_update = None
        self._ledger.release(runtime.name)
        self._ledger.rename(candidate_owner, runtime.name)
        self._persist()
        self._mark_ready(runtime, new_model, plan)
        if old_model is not None:
            await old_model.unload_when_idle(UNLOAD_DRAIN_TIMEOUT_SECONDS)

    async def _replace_in_place(self, runtime: DeploymentRuntime, new_spec: DeploymentSpec) -> None:
        """Not enough memory for both: stop the old model, load the new one, roll back if it fails."""
        previous_spec = runtime.spec
        await self._stop_model(runtime, UNLOAD_DRAIN_TIMEOUT_SECONDS)
        try:
            plan, reservation = await self._plan(new_spec, owner=runtime.name)
        except LocalLlmError:
            plan, reservation = await self._plan(previous_spec, owner=runtime.name)
            self._start_loading(runtime, plan, reservation)
            raise
        runtime.spec = new_spec
        self._persist()
        self._start_loading(runtime, plan, reservation)
        self._spawn(self._roll_back_if_failed(runtime, previous_spec), f"rollback-{runtime.name}")

    async def _roll_back_if_failed(self, runtime: DeploymentRuntime, previous_spec: DeploymentSpec) -> None:
        if runtime.lifecycle_task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await runtime.lifecycle_task
        if runtime.status is not DeploymentStatus.FAILED:
            return
        failure_message = runtime.last_error
        logger.warning("Update failed; restoring the previous model", extra={"deployment": runtime.name})
        async with runtime.lifecycle_lock:
            runtime.spec = previous_spec
            self._persist()
            plan, reservation = await self._plan(previous_spec, owner=runtime.name)
            self._start_loading(runtime, plan, reservation)
        runtime.last_error = f"Update failed and was rolled back: {failure_message}"

    def _apply_spec_change(self, runtime: DeploymentRuntime, new_spec: DeploymentSpec) -> None:
        runtime.spec = new_spec
        self._persist()
        if runtime.status is DeploymentStatus.READY:
            self._registrar.mark_available(runtime.name, self._registration_payload(runtime))

    # ------------------------------------------------------------------ background supervision

    async def _load_on_boot(self) -> None:
        """Load the system deployment first, then admin deployments one at a time (avoids memory spikes)."""
        for runtime in self.list_runtimes():
            if runtime.spec.should_be_loaded:
                await self._load_and_wait(runtime)

    async def _load_and_wait(self, runtime: DeploymentRuntime) -> None:
        """Never raises: any failure (a Hub network error too) marks the deployment FAILED, so it is retried."""
        try:
            await self.load(runtime.name)
            if runtime.lifecycle_task is not None:
                with contextlib.suppress(asyncio.CancelledError):
                    await runtime.lifecycle_task
        except Exception as error:
            if not isinstance(error, LocalLlmError):
                logger.exception("Loading the deployment failed", extra={"deployment": runtime.name})
            runtime.change_status(DeploymentStatus.FAILED, _describe_error(error))
            self._registrar.mark_unavailable(runtime.name)

    async def _supervise_forever(self) -> None:
        """Detect crashed engines, refresh memory gauges and keep retrying a failed system deployment."""
        while True:
            await asyncio.sleep(SUPERVISOR_INTERVAL_SECONDS)
            for runtime in list(self._runtimes.values()):
                self._check_engine_health(runtime)
            await self._retry_system_deployment_if_failed()

    def _check_engine_health(self, runtime: DeploymentRuntime) -> None:
        managed_model = runtime.managed_model
        if runtime.status is not DeploymentStatus.READY or managed_model is None:
            return
        loaded_model = managed_model.loaded_model
        if loaded_model.is_alive():
            return
        runtime.managed_model = None
        self._record_load_failure(runtime, RuntimeError("the engine process exited unexpectedly"))
        self._spawn(loaded_model.unload(), f"cleanup-{runtime.name}")

    async def _retry_system_deployment_if_failed(self) -> None:
        system_runtime = self.system_runtime
        seconds_since_failure = (datetime.now(UTC) - system_runtime.status_changed_at).total_seconds()
        if system_runtime.status is DeploymentStatus.FAILED and seconds_since_failure >= SYSTEM_RETRY_INTERVAL_SECONDS:
            logger.info("Retrying the system deployment", extra={"deployment": system_runtime.name})
            await self._load_and_wait(system_runtime)

    # ------------------------------------------------------------------ helpers

    def _system_spec(self, stored_spec: DeploymentSpec | None) -> DeploymentSpec:
        """Environment variables seed the system deployment; admin upgrades (stored) take precedence."""
        settings = self._settings
        seeded_spec = DeploymentSpec(
            name=settings.system_deployment_name,
            model_id=settings.system_model_id,
            revision=settings.system_model_revision,
            device=settings.system_device,
            dtype=settings.system_dtype,
            display_name="Nemotron Parse",
            context_window_tokens=settings.system_context_window_tokens,
            max_output_tokens=settings.system_max_output_tokens,
            default_for_tasks=settings.system_default_task_names,
            is_system=True,
        )
        if stored_spec is None:
            return seeded_spec
        return stored_spec.model_copy(update={"is_system": True, "should_be_loaded": True})

    def _new_runtime(self, spec: DeploymentSpec) -> DeploymentRuntime:
        return DeploymentRuntime(
            spec=spec,
            admission=DeploymentAdmission(
                self._settings.concurrent_requests_per_deployment,
                self._settings.max_queued_requests_per_deployment,
            ),
            throughput=ThroughputTracker(self._settings.throughput_window_seconds),
        )

    def _require_admin_deployment(self, deployment_name: str, action: str) -> DeploymentRuntime:
        runtime = self.get_runtime(deployment_name)
        if runtime.spec.is_system:
            raise SystemDeploymentProtectedError(
                f"The system deployment '{deployment_name}' cannot be {action}; restart or update it instead"
            )
        return runtime

    def _registration_payload(self, runtime: DeploymentRuntime) -> RegistrationPayload:
        plan = runtime.plan
        managed_model = runtime.managed_model
        if plan is None or managed_model is None:
            raise RuntimeError(f"Deployment '{runtime.name}' has no loaded model to register")
        return RegistrationPayload(
            display_name=runtime.spec.display_name or runtime.spec.model_id,
            base_url=f"{self._settings.public_base_url}/v1",
            capabilities=("vision",) if managed_model.loaded_model.is_vision else (),
            context_window_tokens=plan.context_window_tokens,
            max_output_tokens=plan.max_output_tokens,
            default_for_tasks=runtime.spec.default_for_tasks,
            reasoning_control=effective_reasoning_control(
                runtime.spec.reasoning_control, managed_model.loaded_model.has_thinking_switch
            ),
        )

    def _persist(self) -> None:
        self._store.save_all([runtime.spec for runtime in self._runtimes.values()])

    def _spawn(self, coroutine: Any, task_name: str) -> "asyncio.Task[None]":
        task: asyncio.Task[None] = asyncio.create_task(coroutine, name=task_name)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task


def _plan_for_device(
    resolved_model: ResolvedModel,
    spec: DeploymentSpec,
    device: ResolvedDevice,
    context_window_tokens: int,
    max_output_tokens: int,
) -> LoadedState:
    dtype = resolve_dtype(spec.dtype, device)
    return LoadedState(
        resolved_model=resolved_model,
        dtype=dtype,
        context_window_tokens=context_window_tokens,
        max_output_tokens=max_output_tokens,
        estimated_bytes=estimate_required_bytes(resolved_model, dtype, context_window_tokens),
    )


def _note_swap_progress(runtime: DeploymentRuntime, new_spec: DeploymentSpec, status: DeploymentStatus) -> None:
    runtime.pending_update = f"{status.value} {new_spec.model_id}"


def _describe_error(error: Exception) -> str:
    """Domain errors give their client message; other errors their type and a truncated message."""
    if isinstance(error, LocalLlmError):
        return error.client_message
    return f"{type(error).__name__}: {error}"[:MAX_ERROR_MESSAGE_LENGTH]
