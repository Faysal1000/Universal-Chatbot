"""The contract every inference engine (Transformers, llama.cpp) implements."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from app.deployments.models import ResolvedDevice, ResolvedModel, TorchDtypeName
from app.schemas.openai import ChatCompletionRequest, FinishReason


@dataclass(frozen=True, slots=True)
class LoadRequest:
    """Everything an engine needs to load one deployment."""

    deployment_name: str
    resolved_model: ResolvedModel
    model_directory: Path
    device: ResolvedDevice
    dtype: TorchDtypeName
    context_window_tokens: int
    max_output_tokens: int
    cpu_threads: int


@dataclass(frozen=True, slots=True)
class GenerationStats:
    """Measured outcome of one completion, used for throughput."""

    prompt_tokens: int
    completion_tokens: int
    generation_seconds: float
    finish_reason: FinishReason
    pages: int = 0


class GenerationObserver(Protocol):
    """Receives the outcome of a completion."""

    def on_finished(self, stats: GenerationStats) -> None:
        """Generation ended (normally, by length, or by cancellation)."""


class LoadedModel(Protocol):
    """A model that is in memory and can serve OpenAI Chat Completions."""

    @property
    def device(self) -> ResolvedDevice:
        """Where the model runs."""

    @property
    def is_vision(self) -> bool:
        """True when the model accepts ``image_url`` content parts."""

    @property
    def is_document_parser(self) -> bool:
        """True when one request is one parsed page (reported as pages/minute)."""

    @property
    def has_thinking_switch(self) -> bool:
        """True when the chat template turns reasoning on or off with ``enable_thinking``."""

    def is_alive(self) -> bool:
        """False once the engine has crashed and the deployment must be marked failed."""

    def measured_memory_bytes(self) -> int:
        """Memory actually used by this model, measured after loading."""

    async def complete(self, request: ChatCompletionRequest, observer: GenerationObserver) -> dict[str, Any]:
        """Return a non-streamed ``chat.completion`` body."""

    def stream(self, request: ChatCompletionRequest, observer: GenerationObserver) -> AsyncIterator[bytes]:
        """Yield Server-Sent Events bytes ending with ``data: [DONE]``."""

    async def run_smoke_test(self) -> None:
        """Generate a few tokens; raise if the model cannot produce output."""

    async def unload(self) -> None:
        """Free every resource held by the model; safe to call more than once."""


class Engine(Protocol):
    """Loads models of one kind."""

    async def load(self, load_request: LoadRequest) -> LoadedModel:
        """Load the model described by ``load_request``; raise on failure."""
