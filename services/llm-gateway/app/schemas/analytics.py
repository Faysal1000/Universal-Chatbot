"""Dashboard analytics responses (see ``app.services.analytics_service`` for definitions)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

AnalyticsGroupBy = Literal["model", "provider", "task"]


class PercentileSummary(BaseModel):
    """p50/p90/p99 of one measurement (``None`` when there is no data)."""

    p50: float | None
    p90: float | None
    p99: float | None


class AnalyticsGroupSummary(BaseModel):
    """Aggregates for one model, provider, or task over the selected range."""

    group_key: str
    provider_id: str | None = None
    model_id: str | None = None
    task_name: str | None = None
    request_count: int
    success_count: int
    error_count: int
    error_rate: float
    fallback_count: int
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int
    reasoning_tokens: int
    cost_usd: float | None
    latency_ms: PercentileSummary
    time_to_first_token_ms: PercentileSummary
    output_tokens_per_second: PercentileSummary


class AnalyticsOverviewResponse(BaseModel):
    """Totals plus one row per group for the selected time range."""

    start: datetime
    end: datetime
    group_by: AnalyticsGroupBy
    unique_request_count: int
    totals: AnalyticsGroupSummary
    groups: list[AnalyticsGroupSummary]


class TimeseriesPoint(BaseModel):
    """Aggregates for one time bucket and group."""

    bucket_start: datetime
    group_key: str
    request_count: int
    error_count: int
    input_tokens: int
    output_tokens: int
    cost_usd: float | None
    latency_p50_ms: float | None
    latency_p90_ms: float | None
    latency_p99_ms: float | None
    time_to_first_token_p50_ms: float | None
    time_to_first_token_p90_ms: float | None
    time_to_first_token_p99_ms: float | None
    output_tokens_per_second_p50: float | None


class AnalyticsTimeseriesResponse(BaseModel):
    """Bucketed series; buckets without traffic are omitted."""

    start: datetime
    end: datetime
    bucket_seconds: int
    group_by: AnalyticsGroupBy
    points: list[TimeseriesPoint]


class TopErrorEntry(BaseModel):
    """One error class on one model, with a sample message."""

    error_class: str
    provider_id: str
    model_id: str
    http_status: int
    occurrence_count: int
    last_seen_at: datetime
    sample_message: str | None


class RecentRequestEntry(BaseModel):
    """One recent request-metrics row (no bodies are ever stored)."""

    started_at: datetime
    request_id: str
    task_name: str
    provider_id: str
    model_id: str
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
    cost_usd: float | None
    cost_saved_usd: float | None
    chain_step: int | None = Field(description="Position in the task's model chain of this row's model")
    chain_steps_tried: int | None = Field(description="Chain steps reached so far, including skipped ones")
    fallback_reason: str | None = Field(
        description="Why the chain moved past the previous step: its error class, or circuit_open"
    )


class ChainStepShare(BaseModel):
    """How many requests one chain step served."""

    chain_step: int
    served_count: int
    share: float = Field(description="served_count / the task's served requests (0-1)")


class FallbackReasonCount(BaseModel):
    """How often the chain moved on for one reason (an error class, or circuit_open)."""

    reason: str
    occurrence_count: int


class TaskChainStepSummary(BaseModel):
    """Which chain steps served a task's requests, and why requests moved down the chain."""

    task_name: str
    served_request_count: int
    steps: list[ChainStepShare]
    fallback_reasons: list[FallbackReasonCount]


class ChainStepAnalyticsResponse(BaseModel):
    """Share of requests served by each chain step, per task."""

    start: datetime
    end: datetime
    tasks: list[TaskChainStepSummary]
