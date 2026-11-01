"""Deployment domain types: what the admin configures and what the service resolved."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.config import DeviceRequest, ModelDtype

DEPLOYMENT_NAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
# "org/repo" or, for GGUF repositories, "org/repo:QUANT" (for example ":Q4_K_M").
MODEL_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*(:[A-Za-z0-9_.-]+)?$"
TASK_NAME_PATTERN = r"^[a-z][a-z0-9_.-]{0,62}$"

EngineKind = Literal["transformers", "llama_cpp"]
# How llm-gateway tells this deployment whether to reason (the gateway's per-model ``reasoning_control``).
ReasoningControl = Literal["reasoning_effort", "enable_thinking"]
# ``auto`` detects Qwen's thinking switch from the loaded model's chat template.
ReasoningControlSetting = Literal["auto", "reasoning_effort", "enable_thinking"]
ResolvedDevice = Literal["cpu", "cuda"]
TorchDtypeName = Literal["bfloat16", "float16", "float32"]


class DeploymentStatus(StrEnum):
    """Lifecycle of a deployment; only ``READY`` deployments serve requests."""

    UNLOADED = "unloaded"
    DOWNLOADING = "downloading"
    LOADING = "loading"
    READY = "ready"
    UNLOADING = "unloading"
    FAILED = "failed"


class DeploymentSpec(BaseModel):
    """Everything the admin configures for one deployment; persisted across restarts."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str = Field(pattern=DEPLOYMENT_NAME_PATTERN)
    model_id: str = Field(pattern=MODEL_ID_PATTERN, max_length=200)
    revision: str | None = Field(default=None, min_length=1, max_length=100)
    device: DeviceRequest = "auto"
    dtype: ModelDtype = "auto"
    display_name: str | None = Field(default=None, max_length=200)
    context_window_tokens: int | None = Field(default=None, ge=256, le=1_048_576)
    max_output_tokens: int | None = Field(default=None, ge=1, le=1_048_576)
    default_for_tasks: tuple[str, ...] = ()
    reasoning_control: ReasoningControlSetting = "auto"
    is_system: bool = False
    # Whether the deployment should be loaded after a restart (the admin's last load/unload).
    should_be_loaded: bool = True


def effective_reasoning_control(setting: ReasoningControlSetting, has_thinking_switch: bool) -> ReasoningControl | None:
    """What to register with the gateway; ``None`` (omitted) leaves the gateway's stored value alone.

    ``auto`` only ever claims the thinking switch, so an admin's choice on the gateway survives for
    models without one (Nemotron Parse, for example).
    """
    if setting != "auto":
        return setting
    return "enable_thinking" if has_thinking_switch else None


@dataclass(frozen=True, slots=True)
class ModelReference:
    """A parsed ``model_id``: the repository plus an optional GGUF quantisation tag."""

    repository_id: str
    quantization: str | None

    @classmethod
    def parse(cls, model_id: str) -> "ModelReference":
        """Split ``org/repo:QUANT`` into its parts."""
        repository_id, _, quantization = model_id.partition(":")
        return cls(repository_id=repository_id, quantization=quantization or None)

    @property
    def organization(self) -> str:
        """The Hugging Face organisation or user that owns the repository."""
        return self.repository_id.split("/", 1)[0]


@dataclass(frozen=True, slots=True)
class ResolvedModel:
    """Facts about a model read from Hugging Face before anything is downloaded."""

    repository_id: str
    revision: str
    engine: EngineKind
    files_to_download: tuple[str, ...]
    is_vision: bool
    needs_remote_code: bool
    model_type: str | None
    native_context_window_tokens: int | None
    # From the safetensors index or the GGUF metadata; 0 when the repository does not say.
    parameter_count: int
    weight_file_bytes: int
    gguf_model_file: str | None = None
    gguf_projector_file: str | None = None
