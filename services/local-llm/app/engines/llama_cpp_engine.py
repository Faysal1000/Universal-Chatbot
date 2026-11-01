"""llama.cpp engine: one ``llama-server`` child process per GGUF deployment, proxied over localhost.

Each child listens on 127.0.0.1 only and requires a random per-process key passed through
the environment (never on the command line, where ``ps`` would show it). Requests are
forwarded unchanged apart from ``model``, so every llama.cpp sampling option works.
"""

import asyncio
import contextlib
import json
import logging
import os
import secrets
import socket
import time
from collections import deque
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx

from app.deployments.models import ResolvedDevice
from app.engines.base import GenerationObserver, GenerationStats, LoadRequest
from app.engines.chat_templates import has_thinking_switch
from app.engines.sse import SSE_DONE, encode_sse_error
from app.errors import InferenceFailedError, InferenceTimeoutError, InvalidRequestError
from app.hardware import process_tree_rss_bytes
from app.schemas.openai import ChatCompletionRequest

logger = logging.getLogger(__name__)

LOOPBACK_HOST = "127.0.0.1"
ALL_LAYERS_ON_GPU = "999"
HEALTH_POLL_INTERVAL_SECONDS = 0.5
STOP_GRACE_SECONDS = 10
RECENT_OUTPUT_LINES = 40
SMOKE_TEST_REQUEST: dict[str, Any] = {
    "messages": [{"role": "user", "content": "Reply with OK."}],
    "max_tokens": 2,
    "temperature": 0,
}


class LlamaCppEngine:
    """Starts ``llama-server`` processes for GGUF deployments."""

    def __init__(
        self, llama_server_binary: Path, startup_timeout_seconds: float, request_timeout_seconds: float
    ) -> None:
        self._llama_server_binary = llama_server_binary
        self._startup_timeout_seconds = startup_timeout_seconds
        self._request_timeout_seconds = request_timeout_seconds

    async def load(self, load_request: LoadRequest) -> "LlamaCppLoadedModel":
        """Start the server and wait until it reports healthy; raise with its last output on failure."""
        if not self._llama_server_binary.is_file():
            raise InferenceFailedError(f"llama-server is not installed at {self._llama_server_binary}")
        port = _find_free_loopback_port()
        internal_api_key = secrets.token_urlsafe(32)
        process = await asyncio.create_subprocess_exec(
            *self._build_command(load_request, port),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=_build_environment(load_request.device, internal_api_key),
        )
        recent_output: deque[str] = deque(maxlen=RECENT_OUTPUT_LINES)
        output_reader = asyncio.create_task(_relay_output(process, load_request.deployment_name, recent_output))
        loaded_model = LlamaCppLoadedModel(
            load_request, process, output_reader, port, internal_api_key, self._request_timeout_seconds
        )
        try:
            await loaded_model.wait_until_healthy(self._startup_timeout_seconds)
            await loaded_model.read_chat_template()
        except asyncio.CancelledError:
            await loaded_model.unload()
            raise
        except BaseException as error:
            await loaded_model.unload()
            last_output = " | ".join(recent_output)
            raise InferenceFailedError(f"llama-server failed to start: {last_output[-600:]}") from error
        return loaded_model

    def _build_command(self, load_request: LoadRequest, port: int) -> list[str]:
        resolved_model = load_request.resolved_model
        if resolved_model.gguf_model_file is None:
            raise InferenceFailedError("A GGUF deployment needs a model file")
        command = [
            str(self._llama_server_binary),
            "--model", str(load_request.model_directory / resolved_model.gguf_model_file),
            "--alias", load_request.deployment_name,
            "--host", LOOPBACK_HOST,
            "--port", str(port),
            "--ctx-size", str(load_request.context_window_tokens),
            "--n-predict", str(load_request.max_output_tokens),
            "--n-gpu-layers", ALL_LAYERS_ON_GPU if load_request.device == "cuda" else "0",
            "--threads", str(load_request.cpu_threads),
            "--parallel", "1",
            "--jinja",
            "--no-webui",
        ]  # fmt: skip
        if resolved_model.gguf_projector_file is not None:
            command += ["--mmproj", str(load_request.model_directory / resolved_model.gguf_projector_file)]
        return command


class LlamaCppLoadedModel:
    """A running ``llama-server`` child serving one deployment."""

    def __init__(
        self,
        load_request: LoadRequest,
        process: asyncio.subprocess.Process,
        output_reader: "asyncio.Task[None]",
        port: int,
        internal_api_key: str,
        request_timeout_seconds: float,
    ) -> None:
        self._load_request = load_request
        self._process = process
        self._output_reader = output_reader
        self._http_client = httpx.AsyncClient(
            base_url=f"http://{LOOPBACK_HOST}:{port}",
            headers={"Authorization": f"Bearer {internal_api_key}"},
            timeout=httpx.Timeout(request_timeout_seconds, connect=5.0),
        )
        self._chat_template: str | None = None

    @property
    def device(self) -> ResolvedDevice:
        """Where the model runs."""
        return self._load_request.device

    @property
    def is_vision(self) -> bool:
        """True when a vision projector (mmproj) is loaded."""
        return self._load_request.resolved_model.gguf_projector_file is not None

    @property
    def is_document_parser(self) -> bool:
        """GGUF deployments are chat models."""
        return False

    @property
    def has_thinking_switch(self) -> bool:
        """True when the GGUF's embedded chat template reads ``enable_thinking``."""
        return has_thinking_switch(self._chat_template)

    def is_alive(self) -> bool:
        """False once the child process has exited."""
        return self._process.returncode is None

    def measured_memory_bytes(self) -> int:
        """Resident memory of the child process."""
        return process_tree_rss_bytes(self._process.pid)

    async def wait_until_healthy(self, timeout_seconds: float) -> None:
        """Poll ``/health`` until the model is loaded; fail fast if the process exits."""
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            if not self.is_alive():
                raise RuntimeError(f"llama-server exited with code {self._process.returncode}")
            with contextlib.suppress(httpx.HTTPError):
                response = await self._http_client.get("/health")
                if response.status_code == 200:
                    return
            await asyncio.sleep(HEALTH_POLL_INTERVAL_SECONDS)
        raise TimeoutError(f"llama-server was not healthy within {timeout_seconds:.0f}s")

    async def read_chat_template(self) -> None:
        """Read the chat template llama-server took from the GGUF file (``GET /props``)."""
        response = await self._http_client.get("/props")
        response.raise_for_status()
        chat_template = response.json().get("chat_template")
        self._chat_template = chat_template if isinstance(chat_template, str) else None

    async def complete(self, request: ChatCompletionRequest, observer: GenerationObserver) -> dict[str, Any]:
        """Forward a non-streamed request and return llama-server's ``chat.completion`` body."""
        started_at = time.perf_counter()
        try:
            response = await self._http_client.post("/v1/chat/completions", json=self._upstream_body(request))
        except httpx.TimeoutException as error:
            raise InferenceTimeoutError() from error
        except httpx.HTTPError as error:
            raise InferenceFailedError() from error
        completion: dict[str, Any] = _read_json_or_raise(response)
        observer.on_finished(_stats_from_completion(completion, time.perf_counter() - started_at))
        return completion

    async def stream(self, request: ChatCompletionRequest, observer: GenerationObserver) -> AsyncIterator[bytes]:
        """Relay llama-server's SSE events; usage is always requested upstream so throughput is measured.

        A rejected request raises before the first event (so it becomes an HTTP error);
        failures after that are sent as an SSE error event.
        """
        started_at = time.perf_counter()
        upstream_body = self._upstream_body(request) | {"stream_options": {"include_usage": True}}
        upstream_request = self._http_client.build_request("POST", "/v1/chat/completions", json=upstream_body)
        response = await self._send_streaming(upstream_request)
        stream_monitor = _StreamMonitor(observer, request.includes_stream_usage)
        try:
            if response.status_code != 200:
                await response.aread()
                _read_json_or_raise(response)
            async for line in response.aiter_lines():
                if (event := stream_monitor.relay(line)) is not None:
                    yield event
        except httpx.HTTPError:
            logger.exception("llama-server stream failed", extra={"deployment": self._load_request.deployment_name})
            yield encode_sse_error("The model failed to generate a response", "inference_failed")
            yield SSE_DONE
        finally:
            await response.aclose()
            stream_monitor.finish(time.perf_counter() - started_at)

    async def _send_streaming(self, upstream_request: httpx.Request) -> httpx.Response:
        try:
            return await self._http_client.send(upstream_request, stream=True)
        except httpx.TimeoutException as error:
            raise InferenceTimeoutError() from error
        except httpx.HTTPError as error:
            raise InferenceFailedError() from error

    async def run_smoke_test(self) -> None:
        """Generate two tokens directly against the child."""
        response = await self._http_client.post(
            "/v1/chat/completions", json={"model": self._load_request.deployment_name, **SMOKE_TEST_REQUEST}
        )
        _read_json_or_raise(response)

    async def unload(self) -> None:
        """Stop the child (SIGTERM, then SIGKILL after a grace period) and close the client."""
        await self._http_client.aclose()
        if self.is_alive():
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=STOP_GRACE_SECONDS)
            except TimeoutError:
                self._process.kill()
                await self._process.wait()
        await self._output_reader

    def _upstream_body(self, request: ChatCompletionRequest) -> dict[str, Any]:
        upstream_body = request.model_dump(exclude_none=True)
        upstream_body["model"] = self._load_request.deployment_name
        return upstream_body


class _StreamMonitor:
    """Watches relayed SSE lines for the finish reason and the usage chunk."""

    def __init__(self, observer: GenerationObserver, caller_wants_usage: bool) -> None:
        self._observer = observer
        self._caller_wants_usage = caller_wants_usage
        self._prompt_tokens = 0
        self._completion_tokens = 0
        self._finish_reason = "stop"

    def relay(self, line: str) -> bytes | None:
        """Return the event to forward, or ``None`` to drop it (blank lines, unrequested usage)."""
        if not line.startswith("data: "):
            return None
        payload = line.removeprefix("data: ")
        if payload == "[DONE]":
            return SSE_DONE
        chunk = json.loads(payload)
        self._inspect(chunk)
        if chunk.get("usage") and not chunk.get("choices") and not self._caller_wants_usage:
            return None
        return f"data: {payload}\n\n".encode()

    def finish(self, elapsed_seconds: float) -> None:
        """Report the outcome once the stream ends for any reason."""
        self._observer.on_finished(
            GenerationStats(
                prompt_tokens=self._prompt_tokens,
                completion_tokens=self._completion_tokens,
                generation_seconds=elapsed_seconds,
                finish_reason="length" if self._finish_reason == "length" else "stop",
            )
        )

    def _inspect(self, chunk: dict[str, Any]) -> None:
        for choice in chunk.get("choices") or []:
            if choice.get("finish_reason"):
                self._finish_reason = choice["finish_reason"]
        if usage := chunk.get("usage"):
            self._prompt_tokens = int(usage.get("prompt_tokens", 0))
            self._completion_tokens = int(usage.get("completion_tokens", 0))


def _stats_from_completion(completion: dict[str, Any], elapsed_seconds: float) -> GenerationStats:
    usage = completion.get("usage") or {}
    choices = completion.get("choices") or [{}]
    return GenerationStats(
        prompt_tokens=int(usage.get("prompt_tokens", 0)),
        completion_tokens=int(usage.get("completion_tokens", 0)),
        generation_seconds=elapsed_seconds,
        finish_reason="length" if choices[0].get("finish_reason") == "length" else "stop",
    )


def _read_json_or_raise(response: httpx.Response) -> Any:
    """Parse a successful body; map llama-server's 4xx to invalid requests and anything else to failures."""
    if response.status_code == 200:
        return response.json()
    upstream_message = _upstream_error_message(response)
    if 400 <= response.status_code < 500:
        raise InvalidRequestError(upstream_message)
    raise InferenceFailedError(f"llama-server returned {response.status_code}: {upstream_message}")


def _upstream_error_message(response: httpx.Response) -> str:
    try:
        error_body = response.json().get("error", {})
        return str(error_body.get("message", "request rejected by llama-server"))
    except (ValueError, AttributeError):
        return "request rejected by llama-server"


def _build_environment(device: ResolvedDevice, internal_api_key: str) -> dict[str, str]:
    environment = {name: value for name, value in os.environ.items() if not name.startswith("LOCAL_LLM_")}
    environment["LLAMA_ARG_API_KEY"] = internal_api_key
    if device == "cpu":
        # Keep a CPU deployment off the GPU even when the CUDA backend is present.
        environment["CUDA_VISIBLE_DEVICES"] = ""
    return environment


async def _relay_output(process: asyncio.subprocess.Process, deployment_name: str, recent_output: deque[str]) -> None:
    """Keep llama-server's log at DEBUG and remember its tail for failure messages."""
    if process.stdout is None:
        return
    async for raw_line in process.stdout:
        line = raw_line.decode("utf-8", errors="replace").rstrip()
        recent_output.append(line)
        logger.debug(line, extra={"deployment": deployment_name, "source": "llama-server"})


def _find_free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe_socket:
        probe_socket.bind((LOOPBACK_HOST, 0))
        return int(probe_socket.getsockname()[1])
