"""Shared fixtures: settings, a fake engine and an application wired with fakes.

Nothing here touches the network or loads real weights; engine behaviour is verified
against real models by the Docker checks and ``scripts/benchmark_cpu.py``.
"""

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.deployments.loader import ModelLoader
from app.deployments.manager import DeploymentManager
from app.deployments.memory import MemoryLedger
from app.deployments.models import EngineKind, ResolvedDevice, ResolvedModel
from app.deployments.store import DeploymentStore
from app.engines.base import GenerationObserver, GenerationStats, LoadRequest
from app.engines.sse import SSE_DONE, ChunkFactory, encode_sse_event
from app.gateway_registration import GatewayRegistrar
from app.main import create_app
from app.schemas.openai import ChatCompletionRequest, Usage

TEST_INFERENCE_KEY = "test-inference-key-that-is-long-enough-123456"
TEST_ADMIN_KEY = "test-admin-key-that-is-long-enough-12345678"
GIBIBYTE = 1024**3
SYSTEM_MODEL_ID = "nvidia/Nemotron-3.5-Parse"
FAKE_REPLY = "Hello from the fake model"


def build_settings(tmp_path: Path, **overrides: Any) -> Settings:
    """Settings for tests, never read from a developer's .env file."""
    values: dict[str, Any] = {
        "inference_api_key": TEST_INFERENCE_KEY,
        "admin_api_key": TEST_ADMIN_KEY,
        "state_directory": tmp_path / "state",
        "log_format": "text",
        "memory_capacity_bytes": 8 * GIBIBYTE,
        "memory_reserve_bytes": 0,
        "llama_server_binary": tmp_path / "llama-server",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def resolved_model(model_id: str, parameter_count: int = 600_000_000, is_vision: bool = False) -> ResolvedModel:
    """A Transformers model as the resolver would describe it."""
    engine: EngineKind = "llama_cpp" if ":" in model_id else "transformers"
    return ResolvedModel(
        repository_id=model_id.split(":")[0],
        revision="0" * 40,
        engine=engine,
        files_to_download=("config.json",),
        is_vision=is_vision,
        needs_remote_code=False,
        model_type="nemotron_parse" if model_id == SYSTEM_MODEL_ID else "qwen3_5",
        native_context_window_tokens=32_768,
        parameter_count=parameter_count,
        weight_file_bytes=parameter_count,
    )


class FakeResolver:
    """Resolves any id instantly; ``parameter_counts`` makes chosen models too big to fit."""

    def __init__(self) -> None:
        self.parameter_counts: dict[str, int] = {}

    def resolve(self, model_id: str, revision: str | None) -> ResolvedModel:
        is_vision = model_id == SYSTEM_MODEL_ID
        return resolved_model(model_id, self.parameter_counts.get(model_id, 100_000_000), is_vision)


class FakeLoadedModel:
    """Echo-style model: replies with a fixed sentence, streamed word by word."""

    def __init__(self, load_request: LoadRequest) -> None:
        self._load_request = load_request
        self.is_unloaded = False
        self.alive = True

    @property
    def device(self) -> ResolvedDevice:
        return self._load_request.device

    @property
    def is_vision(self) -> bool:
        return self._load_request.resolved_model.is_vision

    @property
    def is_document_parser(self) -> bool:
        return self._load_request.resolved_model.model_type == "nemotron_parse"

    @property
    def has_thinking_switch(self) -> bool:
        return self._load_request.resolved_model.model_type == "qwen3_5"

    def is_alive(self) -> bool:
        return self.alive

    def measured_memory_bytes(self) -> int:
        return 123

    async def complete(self, request: ChatCompletionRequest, observer: GenerationObserver) -> dict[str, Any]:
        observer.on_finished(GenerationStats(5, 5, 0.5, "stop", pages=1 if self.is_document_parser else 0))
        return {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 0,
            "model": request.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": FAKE_REPLY}, "finish_reason": "stop"}],
            "usage": Usage.from_counts(5, 5).model_dump(),
        }

    async def stream(self, request: ChatCompletionRequest, observer: GenerationObserver) -> AsyncIterator[bytes]:
        chunk_factory = ChunkFactory(request.model)
        yield encode_sse_event(chunk_factory.role_chunk())
        for word in FAKE_REPLY.split(" "):
            yield encode_sse_event(chunk_factory.content_chunk(word + " "))
        observer.on_finished(GenerationStats(5, 5, 0.5, "stop"))
        yield encode_sse_event(chunk_factory.finish_chunk("stop"))
        if request.includes_stream_usage:
            yield encode_sse_event(chunk_factory.usage_chunk(Usage.from_counts(5, 5)))
        yield SSE_DONE

    async def run_smoke_test(self) -> None:
        return None

    async def unload(self) -> None:
        self.is_unloaded = True


class FakeEngine:
    """Loads :class:`FakeLoadedModel`s; ``failing_model_ids`` simulate load failures."""

    def __init__(self) -> None:
        self.failing_model_ids: set[str] = set()
        self.loaded_models: list[FakeLoadedModel] = []
        self.load_gate = asyncio.Event()
        self.load_gate.set()

    async def load(self, load_request: LoadRequest) -> FakeLoadedModel:
        await self.load_gate.wait()
        if load_request.resolved_model.repository_id in self.failing_model_ids:
            raise RuntimeError("simulated load failure")
        loaded_model = FakeLoadedModel(load_request)
        self.loaded_models.append(loaded_model)
        return loaded_model


class FakeGateway:
    """Records registration calls made through an ``httpx.MockTransport``."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.registered: dict[str, dict[str, Any]] = {}
        self.unavailable: set[str] = set()

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if request.method == "GET":
            return httpx.Response(200, json=[])
        name = path.removeprefix("/v1/local-models/").removesuffix("/unavailable")
        if request.method == "PUT":
            self.registered[name] = json.loads(request.content)
            self.unavailable.discard(name)
            return httpx.Response(201, json={"claimed_default_routes": []})
        self.unavailable.add(name)
        return httpx.Response(200, json={})


class AppHarness:
    """Everything a test needs to drive the app and inspect the fakes."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.resolver = FakeResolver()
        self.engine = FakeEngine()
        self.gateway = FakeGateway()
        self.manager: DeploymentManager | None = None

    def build_manager(self, settings: Settings, ledger: MemoryLedger) -> DeploymentManager:
        registrar = GatewayRegistrar(
            settings,
            http_client=httpx.AsyncClient(
                base_url="http://gateway.test", transport=httpx.MockTransport(self.gateway.handle)
            ),
            random_jitter=lambda: 0.0,
        )
        self.manager = DeploymentManager(
            settings=settings,
            store=DeploymentStore(settings.state_directory),
            resolver=self.resolver,  # type: ignore[arg-type]
            loader=ModelLoader(
                {"transformers": self.engine, "llama_cpp": self.engine},
                cpu_threads=1,
                huggingface_token=None,
                snapshot_downloader=lambda *args, **kwargs: str(settings.state_directory),
            ),
            ledger=ledger,
            registrar=registrar,
            usable_devices=lambda engine: frozenset({"cpu"}),
        )
        return self.manager


@pytest.fixture
def harness(tmp_path: Path) -> AppHarness:
    return AppHarness(
        build_settings(
            tmp_path,
            gateway_base_url="http://gateway.test",
            gateway_registration_api_key="registration-key-that-is-long-enough-0001",
            public_base_url="http://local-llm:8000",
        )
    )


@pytest.fixture
async def client(harness: AppHarness) -> AsyncIterator[httpx.AsyncClient]:
    """An HTTP client against the app, started (lifespan) with the system deployment ready."""
    application = create_app(harness.settings, manager_factory=harness.build_manager)
    async with application.router.lifespan_context(application):
        await wait_until_ready(harness, harness.settings.system_deployment_name)
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://local-llm.test") as test_client:
            yield test_client


async def wait_until_ready(harness: AppHarness, deployment_name: str, expected: str = "ready") -> None:
    """Poll the manager until a deployment reaches ``expected`` (background loads are async)."""
    assert harness.manager is not None
    for _ in range(200):
        runtime = harness.manager.get_runtime(deployment_name)
        if runtime.status.value == expected and runtime.pending_update is None:
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"{deployment_name} stayed {runtime.status.value}, expected {expected}")


def inference_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TEST_INFERENCE_KEY}"}


def admin_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TEST_ADMIN_KEY}"}
