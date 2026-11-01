"""Dashboard analytics: time-range rules, bucket sizing, and mapping query rows to responses.

``request_count`` counts model attempt-chains; ``unique_request_count`` counts inbound
requests (a fallback produces two chains for one request). Metric definitions live in
:mod:`app.persistence.request_metrics_repository`.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.persistence import request_metrics_repository
from app.persistence.request_metrics_repository import MetricFilters
from app.schemas.analytics import (
    AnalyticsGroupBy,
    AnalyticsGroupSummary,
    AnalyticsOverviewResponse,
    AnalyticsTimeseriesResponse,
    PercentileSummary,
    RecentRequestEntry,
    TimeseriesPoint,
    TopErrorEntry,
)
from app.services.errors import InvalidParameterError

DEFAULT_TIME_RANGE = timedelta(hours=24)
MAX_TIME_RANGE = timedelta(days=400)
# The smallest of these bucket sizes that yields at most MAX_TIMESERIES_BUCKETS points wins.
TIMESERIES_BUCKET_SIZES_SECONDS = (10, 30, 60, 300, 900, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400)
MAX_TIMESERIES_BUCKETS = 120
MAX_EXPLICIT_TIMESERIES_BUCKETS = 2000


def resolve_time_range(start: datetime | None, end: datetime | None) -> tuple[datetime, datetime]:
    """Apply defaults (last 24 h), treat naive datetimes as UTC, and validate the range."""
    range_end = _as_utc(end) if end is not None else datetime.now(UTC)
    range_start = _as_utc(start) if start is not None else range_end - DEFAULT_TIME_RANGE
    if range_start >= range_end:
        raise InvalidParameterError("start must be before end")
    if range_end - range_start > MAX_TIME_RANGE:
        raise InvalidParameterError(f"Time range must not exceed {MAX_TIME_RANGE.days} days")
    return range_start, range_end


def choose_bucket_seconds(start: datetime, end: datetime) -> int:
    """Smallest standard bucket that keeps the series at or under ~120 points."""
    range_seconds = max((end - start).total_seconds(), 1)
    for bucket_seconds in TIMESERIES_BUCKET_SIZES_SECONDS:
        if range_seconds / bucket_seconds <= MAX_TIMESERIES_BUCKETS:
            return bucket_seconds
    return TIMESERIES_BUCKET_SIZES_SECONDS[-1]


class AnalyticsService:
    """Use cases behind ``/admin/api/analytics/*``."""

    def __init__(self, database_session: AsyncSession) -> None:
        self._database_session = database_session

    async def overview(
        self, start: datetime | None, end: datetime | None, group_by: AnalyticsGroupBy
    ) -> AnalyticsOverviewResponse:
        """Totals and per-group summaries with p50/p90/p99."""
        range_start, range_end = resolve_time_range(start, end)
        totals_row = await request_metrics_repository.select_overall_summary(
            self._database_session, range_start, range_end
        )
        group_rows = await request_metrics_repository.select_group_summaries(
            self._database_session, range_start, range_end, group_by
        )
        return AnalyticsOverviewResponse(
            start=range_start,
            end=range_end,
            group_by=group_by,
            unique_request_count=int(totals_row.unique_request_count),
            totals=_group_summary_from_row(totals_row),
            groups=[_group_summary_from_row(group_row) for group_row in group_rows],
        )

    async def timeseries(
        self,
        start: datetime | None,
        end: datetime | None,
        group_by: AnalyticsGroupBy,
        bucket_seconds: int | None,
        metric_filters: MetricFilters,
    ) -> AnalyticsTimeseriesResponse:
        """Bucketed series for charts; the bucket size is chosen automatically if omitted."""
        range_start, range_end = resolve_time_range(start, end)
        effective_bucket_seconds = bucket_seconds or choose_bucket_seconds(range_start, range_end)
        if (
            range_end - range_start
        ).total_seconds() / effective_bucket_seconds > MAX_EXPLICIT_TIMESERIES_BUCKETS:
            raise InvalidParameterError(
                f"bucket_seconds is too small for this range (max {MAX_EXPLICIT_TIMESERIES_BUCKETS} buckets)"
            )
        rows = await request_metrics_repository.select_timeseries(
            self._database_session, range_start, range_end, group_by, effective_bucket_seconds, metric_filters
        )
        return AnalyticsTimeseriesResponse(
            start=range_start,
            end=range_end,
            bucket_seconds=effective_bucket_seconds,
            group_by=group_by,
            points=[_timeseries_point_from_row(row) for row in rows],
        )

    async def top_errors(
        self, start: datetime | None, end: datetime | None, limit: int
    ) -> list[TopErrorEntry]:
        """Most frequent errors in the range."""
        range_start, range_end = resolve_time_range(start, end)
        rows = await request_metrics_repository.select_top_errors(
            self._database_session, range_start, range_end, limit
        )
        return [
            TopErrorEntry(
                error_class=row.error_class,
                provider_id=row.provider_id,
                model_id=row.model_id,
                http_status=row.http_status,
                occurrence_count=int(row.occurrence_count),
                last_seen_at=row.last_seen_at,
                sample_message=row.sample_message,
            )
            for row in rows
        ]

    async def recent_requests(
        self,
        start: datetime | None,
        end: datetime | None,
        limit: int,
        errors_only: bool,
        metric_filters: MetricFilters,
    ) -> list[RecentRequestEntry]:
        """Newest request-metric rows (no request or response bodies are stored)."""
        range_start, range_end = resolve_time_range(start, end)
        rows = await request_metrics_repository.select_recent_requests(
            self._database_session, range_start, range_end, limit, errors_only, metric_filters
        )
        return [
            RecentRequestEntry(
                **{
                    **row._asdict(),
                    "cost_usd": _rounded(row.cost_usd, 8),
                    "cost_saved_usd": _rounded(row.cost_saved_usd, 8),
                }
            )
            for row in rows
        ]


def _as_utc(moment: datetime) -> datetime:
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment


def _rounded(value: float | None, digits: int = 2) -> float | None:
    return round(float(value), digits) if value is not None else None


def _percentile_summary(percentile_values: list[float] | None) -> PercentileSummary:
    if not percentile_values:
        return PercentileSummary(p50=None, p90=None, p99=None)
    p50, p90, p99 = (_rounded(percentile_value) for percentile_value in percentile_values)
    return PercentileSummary(p50=p50, p90=p90, p99=p99)


def _group_summary_from_row(row: Any) -> AnalyticsGroupSummary:
    request_count = int(row.request_count)
    error_count = int(row.error_count)
    return AnalyticsGroupSummary(
        group_key=str(row.group_key),
        provider_id=row.provider_id,
        model_id=row.model_id,
        task_name=row.task_name,
        request_count=request_count,
        success_count=int(row.success_count),
        error_count=error_count,
        error_rate=round(error_count / request_count, 4) if request_count else 0.0,
        fallback_count=int(row.fallback_count),
        input_tokens=int(row.input_tokens),
        output_tokens=int(row.output_tokens),
        cached_input_tokens=int(row.cached_input_tokens),
        reasoning_tokens=int(row.reasoning_tokens),
        cost_usd=_rounded(row.cost_usd, 6),
        latency_ms=_percentile_summary(row.latency_percentiles),
        time_to_first_token_ms=_percentile_summary(row.ttft_percentiles),
        output_tokens_per_second=_percentile_summary(row.tps_percentiles),
    )


def _timeseries_point_from_row(row: Any) -> TimeseriesPoint:
    latency = _percentile_summary(row.latency_percentiles)
    time_to_first_token = _percentile_summary(row.ttft_percentiles)
    return TimeseriesPoint(
        bucket_start=row.bucket_start,
        group_key=str(row.group_key),
        request_count=int(row.request_count),
        error_count=int(row.error_count),
        input_tokens=int(row.input_tokens),
        output_tokens=int(row.output_tokens),
        cost_usd=_rounded(row.cost_usd, 6),
        latency_p50_ms=latency.p50,
        latency_p90_ms=latency.p90,
        latency_p99_ms=latency.p99,
        time_to_first_token_p50_ms=time_to_first_token.p50,
        time_to_first_token_p90_ms=time_to_first_token.p90,
        time_to_first_token_p99_ms=time_to_first_token.p99,
        output_tokens_per_second_p50=_rounded(row.tps_p50),
    )
