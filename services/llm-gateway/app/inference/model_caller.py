"""Shared machinery for calling one candidate model with retries.

:class:`JsonModelCaller` and :class:`StreamingModelCaller` build on this. A caller
either writes a successful response to the ASGI ``send`` channel, or raises the
:class:`GatewayError` that ended the chain so the orchestrator can fall back.
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx
from starlette.types import Send

from app.core.errors import GatewayError, UnsupportedFeatureError, UpstreamError
from app.inference.attempt_chain import CLIENT_CLOSED_REQUEST_STATUS, ModelAttemptChain
from app.inference.concurrency import ProviderConcurrencyLimiter
from app.inference.retry_policy import RetryPolicy
from app.inference.upstream_http import build_upstream_timeout
from app.metrics.recorder import MetricsRecorder
from app.metrics.request_metric import CLIENT_DISCONNECTED_ERROR_CLASS
from app.protocols.adapter_base import ProtocolAdapter
from app.protocols.types import JsonObject, PreparedUpstreamRequest

logger = logging.getLogger(__name__)


class CommittedStreamFailure(Exception):  # noqa: N818 - a failure outcome, reported in-stream already.
    """A stream failed after output reached the caller: reported in-stream, too late to fall back."""

    def __init__(self, cause: GatewayError) -> None:
        super().__init__(cause.client_message)
        self.cause = cause


@dataclass(frozen=True, slots=True)
class ModelCallDependencies:
    """Process-wide collaborators every model call needs."""

    http_client: httpx.AsyncClient
    concurrency_limiter: ProviderConcurrencyLimiter
    retry_policy: RetryPolicy
    metrics_recorder: MetricsRecorder
    connect_timeout_seconds: float


class ModelCaller(ABC):
    """Calls one model (with retries) and writes the caller's response on success."""

    def __init__(self, dependencies: ModelCallDependencies) -> None:
        self._dependencies = dependencies

    @abstractmethod
    async def serve(
        self, adapter: ProtocolAdapter, chat_request: JsonObject, chain: ModelAttemptChain, send: Send
    ) -> None:
        """Serve the request with ``chain``'s model or raise the error that ended the chain."""

    def prepare_request(
        self, adapter: ProtocolAdapter, chat_request: JsonObject, chain: ModelAttemptChain
    ) -> PreparedUpstreamRequest:
        """Translate the request; an unsupported feature ends this chain (another model may support it)."""
        try:
            return adapter.build_request(chat_request, chain.target)
        except UnsupportedFeatureError as unsupported_error:
            self._dependencies.metrics_recorder.record(
                chain.to_metric(int(unsupported_error.http_status), error=unsupported_error)
            )
            raise

    def upstream_timeout(self, chain: ModelAttemptChain) -> httpx.Timeout:
        """The httpx timeout for ``chain``'s provider."""
        return build_upstream_timeout(chain.target, self._dependencies.connect_timeout_seconds)

    async def wait_before_retry(self, chain: ModelAttemptChain, upstream_error: UpstreamError) -> bool:
        """Sleep with backoff and return ``True`` if this error deserves another attempt."""
        backoff_delay = self._dependencies.retry_policy.delay_before_next_attempt(
            chain.attempt_count, upstream_error, chain.candidate.max_attempts
        )
        if backoff_delay is None:
            return False
        logger.info(
            "Retrying model after retryable failure",
            extra={
                "model": chain.target.qualified_model_name,
                "attempt": chain.attempt_count,
                "error_class": upstream_error.error_code,
                "upstream_status_code": upstream_error.upstream_status_code,
                "backoff_seconds": round(backoff_delay, 3),
            },
        )
        try:
            await asyncio.sleep(backoff_delay)
        except asyncio.CancelledError:
            # Raised inside the caller's ``except UpstreamError`` block, so its own cancel handler misses it.
            self._dependencies.metrics_recorder.record(
                chain.to_metric(CLIENT_CLOSED_REQUEST_STATUS, error_class=CLIENT_DISCONNECTED_ERROR_CLASS)
            )
            raise
        return True
