"""The row recorded for every model attempt-chain (no request or response bodies)."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

# Error class of a call the caller hung up on; not counted as a model failure.
CLIENT_DISCONNECTED_ERROR_CLASS = "client_disconnected"


@dataclass(frozen=True, slots=True)
class RequestMetric:
    """One row of ``request_metrics``; see :class:`RequestMetricRecord` for semantics."""

    started_at: datetime
    request_id: str
    task_name: str
    provider_id: str
    model_id: str
    inbound_protocol: str
    upstream_protocol: str
    is_stream: bool
    is_fallback: bool
    http_status: int
    error_class: str | None
    error_message: str | None
    attempt_count: int
    input_tokens: int | None
    output_tokens: int | None
    cached_input_tokens: int | None
    reasoning_tokens: int | None
    time_to_first_token_ms: float | None
    total_duration_ms: float
    output_tokens_per_second: float | None
    cost_usd: Decimal | None
    cost_saved_usd: Decimal | None = None
    chain_step: int | None = None
    chain_steps_tried: int | None = None
    fallback_reason: str | None = None
