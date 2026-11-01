"""Bookkeeping for one inbound request and for each candidate model it tries.

Every model attempt-chain (all attempts on one model) becomes exactly one
:class:`RequestMetric` row.
"""

import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib.parse import quote

from app.core.errors import GatewayError, truncate_upstream_message
from app.metrics.cost import (
    compute_output_tokens_per_second,
    estimate_cost_usd,
    estimate_prompt_cache_savings_usd,
)
from app.metrics.request_metric import RequestMetric
from app.protocols.types import INBOUND_PROTOCOL, TokenUsage, UpstreamTarget
from app.routing.task_routes import RouteCandidate

CLIENT_CLOSED_REQUEST_STATUS = 499
CHAIN_STEP_HEADER = "X-LLM-Gateway-Chain-Step"
# Width of ``request_metrics.error_class``; a longer provider error code would fail the whole batch insert.
ERROR_CLASS_MAX_LENGTH = 64


@dataclass(frozen=True, slots=True)
class CompletionRequestContext:
    """Facts about the inbound request shared by all of its model attempt-chains."""

    request_id: str
    task_name: str
    is_stream: bool
    client_wants_usage: bool
    completion_id: str
    created_unix_seconds: int


@dataclass(slots=True)
class ModelAttemptChain:
    """Timing and attempt bookkeeping for one candidate model."""

    candidate: RouteCandidate
    request_context: CompletionRequestContext
    # Chain steps reached so far, including this one and any skipped by an open breaker.
    steps_tried: int = 1
    # Why the chain moved past the previous step: its error class, or "circuit_open".
    fallback_reason: str | None = None
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    started_monotonic: float = field(default_factory=time.monotonic)
    attempt_count: int = 0
    time_to_first_token_ms: float | None = None

    @property
    def target(self) -> UpstreamTarget:
        """The model this chain calls."""
        return self.candidate.target

    def elapsed_ms(self) -> float:
        """Milliseconds since the chain started (including retries on this model)."""
        return (time.monotonic() - self.started_monotonic) * 1000.0

    def mark_first_token(self) -> None:
        """Record time-to-first-token once."""
        if self.time_to_first_token_ms is None:
            self.time_to_first_token_ms = round(self.elapsed_ms(), 3)

    def response_headers(self) -> dict[str, str]:
        """Headers that tell the caller which model actually served the request."""
        return {
            # The task is the caller's ``model`` value; quoting keeps the header latin-1 and on one line.
            "X-LLM-Gateway-Task": quote(self.request_context.task_name, safe=""),
            "X-LLM-Gateway-Provider": self.target.provider_id,
            "X-LLM-Gateway-Model": self.target.model_id,
            "X-LLM-Gateway-Fallback": "true" if self.candidate.is_fallback else "false",
            "X-LLM-Gateway-Attempts": str(self.attempt_count),
            CHAIN_STEP_HEADER: str(self.candidate.step_number),
        }

    def to_metric(
        self,
        http_status: int,
        token_usage: TokenUsage | None = None,
        error: GatewayError | None = None,
        error_class: str | None = None,
        error_message: str | None = None,
    ) -> RequestMetric:
        """Summarise the chain as a metrics row. ``error`` overrides class and message."""
        usage = token_usage or TokenUsage()
        total_duration_ms = round(self.elapsed_ms(), 3)
        if error is not None:
            error_class, error_message = error.error_code, error.client_message
        return RequestMetric(
            started_at=self.started_at,
            request_id=self.request_context.request_id,
            task_name=self.request_context.task_name,
            provider_id=self.target.provider_id,
            model_id=self.target.model_id,
            inbound_protocol=INBOUND_PROTOCOL,
            upstream_protocol=self.target.api_protocol,
            is_stream=self.request_context.is_stream,
            is_fallback=self.candidate.is_fallback,
            http_status=http_status,
            error_class=error_class[:ERROR_CLASS_MAX_LENGTH] if error_class else None,
            error_message=truncate_upstream_message(error_message) if error_message else None,
            attempt_count=max(self.attempt_count, 1),
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cached_input_tokens=usage.cached_input_tokens,
            reasoning_tokens=usage.reasoning_tokens,
            time_to_first_token_ms=self.time_to_first_token_ms,
            total_duration_ms=total_duration_ms,
            output_tokens_per_second=compute_output_tokens_per_second(
                usage.output_tokens, total_duration_ms, self.time_to_first_token_ms
            ),
            cost_usd=estimate_cost_usd(self.target, usage),
            cost_saved_usd=estimate_prompt_cache_savings_usd(self.target, usage),
            chain_step=self.candidate.step_number,
            chain_steps_tried=self.steps_tried,
            fallback_reason=self.fallback_reason,
        )
