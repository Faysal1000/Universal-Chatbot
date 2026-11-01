"""Orchestrates one ``/v1/chat/completions`` request across its task's model chain.

* The chain's steps are walked by :class:`ModelChainRunner` (retries per step, circuit
  breakers, fallbacks, one final error listing every step).
* If the caller disconnects, the in-flight upstream call is cancelled at once, which
  closes the provider connection and stops generation (and billing).
"""

import time
import uuid

import httpx
from starlette.types import Send

from app.core.config import Settings
from app.inference.asgi_responses import CancelOnDisconnectResponse
from app.inference.attempt_chain import CompletionRequestContext
from app.inference.concurrency import ProviderConcurrencyLimiter
from app.inference.json_model_caller import JsonModelCaller
from app.inference.model_caller import ModelCallDependencies
from app.inference.model_chain_runner import ModelChainRunner
from app.inference.retry_policy import RetryPolicy
from app.inference.streaming_model_caller import StreamingModelCaller
from app.metrics.recorder import MetricsRecorder
from app.protocols.types import JsonObject
from app.routing.circuit_breaker import CircuitBreakerBoard
from app.routing.task_routes import RouteCandidate, TaskPolicy


class CompletionService:
    """Builds the response for a routed request and walks the model chain when it is sent."""

    def __init__(
        self,
        settings: Settings,
        http_client: httpx.AsyncClient,
        metrics_recorder: MetricsRecorder,
        circuit_breakers: CircuitBreakerBoard,
    ) -> None:
        dependencies = ModelCallDependencies(
            http_client=http_client,
            concurrency_limiter=ProviderConcurrencyLimiter(settings.concurrency_slot_wait_timeout_seconds),
            retry_policy=RetryPolicy.from_settings(settings),
            metrics_recorder=metrics_recorder,
            connect_timeout_seconds=settings.upstream_connect_timeout_seconds,
        )
        self._model_chain_runner = ModelChainRunner(
            JsonModelCaller(dependencies), StreamingModelCaller(dependencies), circuit_breakers
        )

    def create_response(
        self,
        chat_request: JsonObject,
        route_candidates: list[RouteCandidate],
        request_id: str,
        task_policy: TaskPolicy,
    ) -> CancelOnDisconnectResponse:
        """Return the ASGI response that performs the whole call when it is sent."""
        stream_options = chat_request.get("stream_options")
        request_context = CompletionRequestContext(
            request_id=request_id,
            task_name=task_policy.task_name,
            is_stream=bool(chat_request.get("stream")),
            client_wants_usage=isinstance(stream_options, dict) and bool(stream_options.get("include_usage")),
            completion_id=f"chatcmpl-{uuid.uuid4().hex}",
            created_unix_seconds=int(time.time()),
        )

        async def produce(send: Send) -> None:
            await self._model_chain_runner.run(chat_request, route_candidates, request_context, send)

        return CancelOnDisconnectResponse(produce)
