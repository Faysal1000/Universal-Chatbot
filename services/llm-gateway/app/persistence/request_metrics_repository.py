"""Writes to and aggregate reads from the append-only ``request_metrics`` table.

Percentiles are exact (``percentile_cont``) and computed in Postgres over raw rows of
the requested range, which partition pruning keeps to the relevant months.
Definitions shared by every query:

* **success**: ``error_class IS NULL``. Latency, TTFT and tokens/sec percentiles use
  successful rows only, so fast failures do not make a model look quick.
* **error**: any other row except ``client_disconnected`` (a caller hanging up is
  not a model failure).
* **prompt-cache hit**: a model call whose provider reported cached input tokens.

SQL is assembled only from the fixed fragments below; every value is a bound parameter.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import Row, insert, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.metrics.request_metric import CLIENT_DISCONNECTED_ERROR_CLASS
from app.persistence.tables import RequestMetricRecord

MetricGrouping = Literal["model", "provider", "task"]

_GROUP_KEY_EXPRESSIONS: dict[MetricGrouping, str] = {
    "model": "provider_id || '/' || model_id",
    "provider": "provider_id",
    "task": "task_name",
}
_GROUP_IDENTITY_COLUMNS: dict[MetricGrouping, str] = {
    "model": "min(provider_id) AS provider_id, min(model_id) AS model_id, NULL::text AS task_name",
    "provider": "min(provider_id) AS provider_id, NULL::text AS model_id, NULL::text AS task_name",
    "task": "NULL::text AS provider_id, NULL::text AS model_id, min(task_name) AS task_name",
}
_IS_SUCCESS = "error_class IS NULL"
_IS_ERROR = f"(error_class IS NOT NULL AND error_class <> '{CLIENT_DISCONNECTED_ERROR_CLASS}')"
_PERCENTILES = "ARRAY[0.5, 0.9, 0.99]"
_IN_TIME_RANGE = "started_at >= :start AND started_at < :end"

_SUMMARY_AGGREGATES = f"""
    count(*) AS request_count,
    count(*) FILTER (WHERE {_IS_SUCCESS}) AS success_count,
    count(*) FILTER (WHERE {_IS_ERROR}) AS error_count,
    count(*) FILTER (WHERE is_fallback) AS fallback_count,
    coalesce(sum(input_tokens), 0) AS input_tokens,
    coalesce(sum(output_tokens), 0) AS output_tokens,
    coalesce(sum(cached_input_tokens), 0) AS cached_input_tokens,
    coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens,
    sum(cost_usd) AS cost_usd,
    percentile_cont({_PERCENTILES}) WITHIN GROUP (ORDER BY total_duration_ms)
        FILTER (WHERE {_IS_SUCCESS}) AS latency_percentiles,
    percentile_cont({_PERCENTILES}) WITHIN GROUP (ORDER BY time_to_first_token_ms)
        FILTER (WHERE {_IS_SUCCESS} AND time_to_first_token_ms IS NOT NULL) AS ttft_percentiles,
    percentile_cont({_PERCENTILES}) WITHIN GROUP (ORDER BY output_tokens_per_second)
        FILTER (WHERE {_IS_SUCCESS} AND output_tokens_per_second IS NOT NULL) AS tps_percentiles
"""

_TIMESERIES_AGGREGATES = f"""
    count(*) AS request_count,
    count(*) FILTER (WHERE {_IS_ERROR}) AS error_count,
    coalesce(sum(input_tokens), 0) AS input_tokens,
    coalesce(sum(output_tokens), 0) AS output_tokens,
    sum(cost_usd) AS cost_usd,
    percentile_cont({_PERCENTILES}) WITHIN GROUP (ORDER BY total_duration_ms)
        FILTER (WHERE {_IS_SUCCESS}) AS latency_percentiles,
    percentile_cont({_PERCENTILES}) WITHIN GROUP (ORDER BY time_to_first_token_ms)
        FILTER (WHERE {_IS_SUCCESS} AND time_to_first_token_ms IS NOT NULL) AS ttft_percentiles,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY output_tokens_per_second)
        FILTER (WHERE {_IS_SUCCESS} AND output_tokens_per_second IS NOT NULL) AS tps_p50
"""

_RECENT_REQUEST_COLUMNS = (
    "started_at, request_id, task_name, provider_id, model_id, upstream_protocol, is_stream, is_fallback, "
    "http_status, error_class, error_message, attempt_count, input_tokens, output_tokens, "
    "cached_input_tokens, reasoning_tokens, time_to_first_token_ms, total_duration_ms, "
    "output_tokens_per_second, cost_usd, cost_saved_usd, "
    "chain_step, chain_steps_tried, fallback_reason"
)


@dataclass(frozen=True, slots=True)
class MetricFilters:
    """Optional equality filters shared by the series and request-log queries."""

    provider_id: str | None = None
    model_id: str | None = None
    task_name: str | None = None

    def sql_conditions(self) -> tuple[str, dict[str, Any]]:
        """Return ``AND ...`` SQL and its bind parameters."""
        conditions: list[str] = []
        parameters: dict[str, Any] = {}
        for column_name in ("provider_id", "model_id", "task_name"):
            filter_value = getattr(self, column_name)
            if filter_value is not None:
                conditions.append(f"AND {column_name} = :{column_name}")
                parameters[column_name] = filter_value
        return " ".join(conditions), parameters


async def insert_request_metrics(connection: AsyncConnection, metric_rows: list[dict[str, Any]]) -> None:
    """Insert a batch of rows (one multi-row statement)."""
    await connection.execute(insert(RequestMetricRecord), metric_rows)


async def select_overall_summary(database_session: AsyncSession, start: datetime, end: datetime) -> Row[Any]:
    """One row of totals for the range, including ``unique_request_count``."""
    result = await database_session.execute(
        text(
            "SELECT 'all' AS group_key, NULL::text AS provider_id, NULL::text AS model_id, "
            "NULL::text AS task_name, count(DISTINCT request_id) AS unique_request_count, "
            f"{_SUMMARY_AGGREGATES} FROM request_metrics WHERE {_IN_TIME_RANGE}"
        ),
        {"start": start, "end": end},
    )
    return result.one()


async def select_group_summaries(
    database_session: AsyncSession, start: datetime, end: datetime, grouping: MetricGrouping
) -> Sequence[Row[Any]]:
    """One summary row per model, provider, or task, busiest first."""
    result = await database_session.execute(
        text(
            f"SELECT {_GROUP_KEY_EXPRESSIONS[grouping]} AS group_key, {_GROUP_IDENTITY_COLUMNS[grouping]}, "
            f"{_SUMMARY_AGGREGATES} FROM request_metrics WHERE {_IN_TIME_RANGE} "
            "GROUP BY 1 ORDER BY request_count DESC, group_key"
        ),
        {"start": start, "end": end},
    )
    return result.all()


async def select_timeseries(
    database_session: AsyncSession,
    start: datetime,
    end: datetime,
    grouping: MetricGrouping,
    bucket_seconds: int,
    metric_filters: MetricFilters,
) -> Sequence[Row[Any]]:
    """Per-bucket, per-group aggregates; buckets are aligned to multiples of ``bucket_seconds``."""
    filter_sql, filter_parameters = metric_filters.sql_conditions()
    result = await database_session.execute(
        text(
            "SELECT date_bin(make_interval(secs => :bucket_seconds), started_at, "
            "TIMESTAMPTZ '2000-01-01 00:00:00+00') AS bucket_start, "
            f"{_GROUP_KEY_EXPRESSIONS[grouping]} AS group_key, {_TIMESERIES_AGGREGATES} "
            f"FROM request_metrics WHERE {_IN_TIME_RANGE} {filter_sql} GROUP BY 1, 2 ORDER BY 1, 2"
        ),
        {"start": start, "end": end, "bucket_seconds": bucket_seconds, **filter_parameters},
    )
    return result.all()


async def select_top_errors(
    database_session: AsyncSession, start: datetime, end: datetime, limit: int
) -> Sequence[Row[Any]]:
    """Most frequent error classes per model, with the latest message as a sample."""
    result = await database_session.execute(
        text(
            "SELECT error_class, provider_id, model_id, http_status, count(*) AS occurrence_count, "
            "max(started_at) AS last_seen_at, "
            "(array_agg(error_message ORDER BY started_at DESC))[1] AS sample_message "
            f"FROM request_metrics WHERE {_IN_TIME_RANGE} AND error_class IS NOT NULL "
            "GROUP BY error_class, provider_id, model_id, http_status "
            "ORDER BY occurrence_count DESC, last_seen_at DESC LIMIT :row_limit"
        ),
        {"start": start, "end": end, "row_limit": limit},
    )
    return result.all()


async def select_recent_requests(
    database_session: AsyncSession,
    start: datetime,
    end: datetime,
    limit: int,
    errors_only: bool,
    metric_filters: MetricFilters,
) -> Sequence[Row[Any]]:
    """Newest rows first."""
    filter_sql, filter_parameters = metric_filters.sql_conditions()
    errors_sql = "AND error_class IS NOT NULL" if errors_only else ""
    result = await database_session.execute(
        text(
            f"SELECT {_RECENT_REQUEST_COLUMNS} FROM request_metrics "
            f"WHERE {_IN_TIME_RANGE} {filter_sql} {errors_sql} "
            "ORDER BY started_at DESC, id DESC LIMIT :row_limit"
        ),
        {"start": start, "end": end, "row_limit": limit, **filter_parameters},
    )
    return result.all()


async def select_chain_step_counts(
    database_session: AsyncSession, start: datetime, end: datetime, task_name: str | None
) -> tuple[Sequence[Row[Any]], Sequence[Row[Any]]]:
    """Per task: successful calls served by each chain step, then how often each fallback reason occurred."""
    task_sql = "AND task_name = :task_name" if task_name is not None else ""
    parameters: dict[str, Any] = {"start": start, "end": end, "task_name": task_name}
    served_result = await database_session.execute(
        text(
            "SELECT task_name, chain_step, count(*) AS served_count FROM request_metrics "
            f"WHERE {_IN_TIME_RANGE} {task_sql} AND {_IS_SUCCESS} AND chain_step IS NOT NULL "
            "GROUP BY task_name, chain_step ORDER BY task_name, chain_step"
        ),
        parameters,
    )
    reasons_result = await database_session.execute(
        text(
            "SELECT task_name, fallback_reason, count(*) AS occurrence_count FROM request_metrics "
            f"WHERE {_IN_TIME_RANGE} {task_sql} AND fallback_reason IS NOT NULL "
            "GROUP BY task_name, fallback_reason ORDER BY task_name, occurrence_count DESC"
        ),
        parameters,
    )
    return served_result.all(), reasons_result.all()
