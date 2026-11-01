"""Admin API request and response bodies (``/admin/v1``), consumed by the admin console."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.config import DeviceRequest, ModelDtype
from app.deployments.models import (
    DEPLOYMENT_NAME_PATTERN,
    MODEL_ID_PATTERN,
    TASK_NAME_PATTERN,
    DeploymentStatus,
    EngineKind,
    ReasoningControl,
    ReasoningControlSetting,
    ResolvedDevice,
)

TaskName = Annotated[str, StringConstraints(pattern=TASK_NAME_PATTERN)]
REASONING_CONTROL_DESCRIPTION = (
    "How llm-gateway switches reasoning for this deployment: `auto` registers `enable_thinking` when the "
    "model's chat template has Qwen's thinking switch and otherwise leaves the gateway's setting alone"
)


class DeploymentCreateRequest(BaseModel):
    """Deploy a Hugging Face model (``org/repo``, or ``org/repo:QUANT`` for GGUF) under a name."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=DEPLOYMENT_NAME_PATTERN, examples=["qwen3.5-0.8b"])
    model_id: str = Field(pattern=MODEL_ID_PATTERN, max_length=200, examples=["unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M"])
    revision: str | None = Field(default=None, max_length=100, description="Commit SHA, branch or tag; blank = main")
    device: DeviceRequest = "auto"
    dtype: ModelDtype = Field(default="auto", description="Transformers models only; GGUF files fix their own")
    display_name: str | None = Field(default=None, max_length=200)
    context_window_tokens: int | None = Field(default=None, ge=256, le=1_048_576)
    max_output_tokens: int | None = Field(default=None, ge=1, le=1_048_576)
    default_for_tasks: list[TaskName] = Field(default_factory=list, max_length=50)
    reasoning_control: ReasoningControlSetting = Field(default="auto", description=REASONING_CONTROL_DESCRIPTION)


class DeploymentUpdateRequest(BaseModel):
    """Change a deployment; a new ``model_id`` or ``revision`` swaps the model without downtime when memory allows."""

    model_config = ConfigDict(extra="forbid")

    model_id: str | None = Field(default=None, pattern=MODEL_ID_PATTERN, max_length=200)
    revision: str | None = Field(default=None, max_length=100)
    device: DeviceRequest | None = None
    dtype: ModelDtype | None = None
    display_name: str | None = Field(default=None, max_length=200)
    context_window_tokens: int | None = Field(default=None, ge=256, le=1_048_576)
    max_output_tokens: int | None = Field(default=None, ge=1, le=1_048_576)
    default_for_tasks: list[TaskName] | None = Field(default=None, max_length=50)
    reasoning_control: ReasoningControlSetting | None = Field(default=None, description=REASONING_CONTROL_DESCRIPTION)


class ConfiguredSettingsView(BaseModel):
    """Exactly what the admin configured; the top-level fields show what the service resolved and runs."""

    revision: str | None = Field(description="null = main")
    device: DeviceRequest
    dtype: ModelDtype
    context_window_tokens: int | None = Field(description="null = the model's native window, capped by the default")
    max_output_tokens: int | None = Field(description="null = the service default")
    reasoning_control: ReasoningControlSetting


class MemoryView(BaseModel):
    """Estimated (before loading), reserved (admission) and measured (after loading) memory."""

    estimated_bytes: int | None
    reserved_bytes: int | None
    measured_bytes: int | None


class ThroughputView(BaseModel):
    """Speed over the recent window; rates are null until a request completes."""

    window_seconds: int
    completed_requests: int
    generated_tokens: int
    tokens_per_second: float | None
    pages_parsed: int
    seconds_per_page: float | None
    pages_per_minute: float | None


class DeploymentView(BaseModel):
    """One deployment as the admin console shows it."""

    name: str
    display_name: str | None
    model_id: str
    revision: str | None = Field(description="Requested revision (null = main)")
    resolved_revision: str | None = Field(description="Commit actually loaded")
    engine: EngineKind | None
    is_system: bool
    status: DeploymentStatus
    status_changed_at: datetime
    loaded_at: datetime | None
    device: DeviceRequest
    resolved_device: ResolvedDevice | None
    dtype: str | None
    capabilities: list[str]
    context_window_tokens: int | None
    max_output_tokens: int | None
    reasoning_control: ReasoningControl | None = Field(
        description="Registered with llm-gateway; null = not sent (not loaded, or left to the gateway)"
    )
    default_for_tasks: list[str]
    configured: ConfiguredSettingsView
    memory: MemoryView
    throughput: ThroughputView
    requests_in_flight: int
    requests_queued: int
    pending_update: str | None
    last_error: str | None


class DeploymentList(BaseModel):
    """Every deployment, system deployment first."""

    data: list[DeploymentView]


class GpuView(BaseModel):
    """One CUDA device."""

    index: int
    name: str
    total_memory_bytes: int
    free_memory_bytes: int


class DeviceBudgetView(BaseModel):
    """What admission control may hand out on one device."""

    device: ResolvedDevice
    capacity_bytes: int
    reserved_bytes: int
    free_bytes: int


class EngineSupportView(BaseModel):
    """Which engines can use a GPU in this image on this host."""

    transformers_cuda: bool
    llama_cpp_installed: bool
    llama_cpp_cuda: bool


class SystemView(BaseModel):
    """Host resources and memory budgets."""

    cpu_cores: int
    ram_capacity_bytes: int
    ram_available_bytes: int
    memory_reserve_bytes: int
    gpus: list[GpuView]
    budgets: list[DeviceBudgetView]
    engines: EngineSupportView
