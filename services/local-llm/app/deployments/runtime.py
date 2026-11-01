"""Live state of one deployment: its spec, lifecycle status, loaded model and traffic statistics."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.admission import DeploymentAdmission
from app.deployments.models import DeploymentSpec, DeploymentStatus, ResolvedModel, TorchDtypeName
from app.engines.base import GenerationStats, LoadedModel
from app.errors import DeploymentNotReadyError
from app.throughput import ThroughputTracker


class ManagedModel:
    """A loaded model plus a count of requests using it, so it is unloaded only when idle."""

    def __init__(self, loaded_model: LoadedModel) -> None:
        self.loaded_model = loaded_model
        self._active_request_count = 0
        self._idle_event = asyncio.Event()
        self._idle_event.set()

    @asynccontextmanager
    async def lease(self) -> AsyncIterator[LoadedModel]:
        """Mark the model as in use for the duration of one request."""
        self._active_request_count += 1
        self._idle_event.clear()
        try:
            yield self.loaded_model
        finally:
            self._active_request_count -= 1
            if self._active_request_count == 0:
                self._idle_event.set()

    async def unload_when_idle(self, drain_timeout_seconds: float) -> None:
        """Let in-flight requests finish (up to the timeout), then free the model."""
        with suppress(TimeoutError):  # Draining is best effort; unloading must still happen.
            await asyncio.wait_for(self._idle_event.wait(), timeout=drain_timeout_seconds)
        await self.loaded_model.unload()


@dataclass(slots=True)
class LoadedState:
    """Facts known once a model has been resolved and planned (before and after loading)."""

    resolved_model: ResolvedModel
    dtype: TorchDtypeName
    context_window_tokens: int
    max_output_tokens: int
    estimated_bytes: int


@dataclass(slots=True)
class DeploymentRuntime:
    """Mutable state of one deployment; changed only by the deployment manager."""

    spec: DeploymentSpec
    admission: DeploymentAdmission
    throughput: ThroughputTracker
    status: DeploymentStatus = DeploymentStatus.UNLOADED
    status_changed_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    plan: LoadedState | None = None
    managed_model: ManagedModel | None = None
    last_error: str | None = None
    pending_update: str | None = None
    loaded_at: datetime | None = None
    lifecycle_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    lifecycle_task: "asyncio.Task[None] | None" = None

    @property
    def name(self) -> str:
        """The deployment name (also the ``model`` value callers send)."""
        return self.spec.name

    def change_status(self, status: DeploymentStatus, error_message: str | None = None) -> None:
        """Move to ``status``; a failure records why, any other status clears the error."""
        self.status = status
        self.status_changed_at = datetime.now(UTC)
        self.last_error = error_message

    def require_ready_model(self) -> ManagedModel:
        """The model to serve a request with, or 503 when it is not loaded."""
        if self.status is not DeploymentStatus.READY or self.managed_model is None:
            raise DeploymentNotReadyError(f"Deployment '{self.name}' is {self.status.value}")
        return self.managed_model

    def observe_request(self) -> "RequestObserver":
        """A fresh observer that feeds this deployment's throughput window."""
        return RequestObserver(self.throughput)


class RequestObserver:
    """Records one finished request into the throughput window."""

    def __init__(self, throughput: ThroughputTracker) -> None:
        self._throughput = throughput

    def on_finished(self, stats: GenerationStats) -> None:
        if stats.completion_tokens > 0:
            self._throughput.record(stats)
