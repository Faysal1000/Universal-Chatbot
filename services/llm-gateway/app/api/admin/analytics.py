"""Admin API for dashboard metrics (``/admin/api/analytics/*``)."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import (
    ADMIN_API_PATH_PREFIX,
    ADMIN_ROUTER_DEPENDENCIES,
    AnalyticsServiceDependency,
    ChainAnalyticsServiceDependency,
)
from app.persistence.request_metrics_repository import MetricFilters
from app.schemas.analytics import (
    AnalyticsGroupBy,
    AnalyticsOverviewResponse,
    AnalyticsTimeseriesResponse,
    ChainStepAnalyticsResponse,
    RecentRequestEntry,
    TopErrorEntry,
)

router = APIRouter(
    prefix=f"{ADMIN_API_PATH_PREFIX}/analytics",
    tags=["admin: analytics"],
    dependencies=ADMIN_ROUTER_DEPENDENCIES,
)

StartQuery = Annotated[
    datetime | None, Query(description="Inclusive range start (ISO-8601). Default: end - 24h")
]
EndQuery = Annotated[datetime | None, Query(description="Exclusive range end (ISO-8601). Default: now")]
GroupByQuery = Annotated[AnalyticsGroupBy, Query()]


def metric_filters(
    provider_id: str | None = None, model_id: str | None = None, task_name: str | None = None
) -> MetricFilters:
    """Optional equality filters shared by the series and request-log endpoints."""
    return MetricFilters(provider_id=provider_id, model_id=model_id, task_name=task_name)


MetricFiltersQuery = Annotated[MetricFilters, Depends(metric_filters)]


@router.get("/overview", response_model=AnalyticsOverviewResponse)
async def overview(
    analytics: AnalyticsServiceDependency,
    start: StartQuery = None,
    end: EndQuery = None,
    group_by: GroupByQuery = "model",
) -> AnalyticsOverviewResponse:
    """Totals and per-model/provider/task summaries with p50/p90/p99."""
    return await analytics.overview(start, end, group_by)


@router.get("/timeseries", response_model=AnalyticsTimeseriesResponse)
async def timeseries(
    analytics: AnalyticsServiceDependency,
    filters: MetricFiltersQuery,
    start: StartQuery = None,
    end: EndQuery = None,
    group_by: GroupByQuery = "model",
    bucket_seconds: Annotated[int | None, Query(ge=10, le=86400)] = None,
) -> AnalyticsTimeseriesResponse:
    """Bucketed series for charts. The bucket size is chosen automatically if omitted."""
    return await analytics.timeseries(start, end, group_by, bucket_seconds, filters)


@router.get("/errors", response_model=list[TopErrorEntry])
async def top_errors(
    analytics: AnalyticsServiceDependency,
    start: StartQuery = None,
    end: EndQuery = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
) -> list[TopErrorEntry]:
    """Most frequent errors in the range."""
    return await analytics.top_errors(start, end, limit)


@router.get("/requests", response_model=list[RecentRequestEntry])
async def recent_requests(
    analytics: AnalyticsServiceDependency,
    filters: MetricFiltersQuery,
    start: StartQuery = None,
    end: EndQuery = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    errors_only: bool = False,
) -> list[RecentRequestEntry]:
    """Newest request-metric rows (no request or response bodies are stored)."""
    return await analytics.recent_requests(start, end, limit, errors_only, filters)


@router.get("/chain-steps", response_model=ChainStepAnalyticsResponse)
async def chain_step_summary(
    chain_analytics: ChainAnalyticsServiceDependency,
    start: StartQuery = None,
    end: EndQuery = None,
    task_name: str | None = None,
) -> ChainStepAnalyticsResponse:
    """Per task: share of requests served by each model-chain step, and why chains moved on."""
    return await chain_analytics.chain_step_summary(start, end, task_name)
