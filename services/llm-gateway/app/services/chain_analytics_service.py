"""Model-chain effectiveness: which chain step served each task's requests, and why chains moved on."""

from collections import defaultdict
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.persistence import request_metrics_repository
from app.schemas.analytics import (
    ChainStepAnalyticsResponse,
    ChainStepShare,
    FallbackReasonCount,
    TaskChainStepSummary,
)
from app.services.analytics_service import resolve_time_range

_SHARE_DIGITS = 4


class ChainAnalyticsService:
    """Use case behind ``/admin/api/analytics/chain-steps``."""

    def __init__(self, database_session: AsyncSession) -> None:
        self._database_session = database_session

    async def chain_step_summary(
        self, start: datetime | None, end: datetime | None, task_name: str | None
    ) -> ChainStepAnalyticsResponse:
        """Per task: share of served requests per chain step and fallback reasons."""
        range_start, range_end = resolve_time_range(start, end)
        served_rows, reason_rows = await request_metrics_repository.select_chain_step_counts(
            self._database_session, range_start, range_end, task_name
        )
        served_counts_by_task: dict[str, dict[int, int]] = defaultdict(dict)
        for served_row in served_rows:
            served_counts_by_task[served_row.task_name][int(served_row.chain_step)] = int(
                served_row.served_count
            )
        reasons_by_task: dict[str, list[FallbackReasonCount]] = defaultdict(list)
        for reason_row in reason_rows:
            reasons_by_task[reason_row.task_name].append(
                FallbackReasonCount(
                    reason=reason_row.fallback_reason, occurrence_count=int(reason_row.occurrence_count)
                )
            )
        task_names = sorted(set(served_counts_by_task) | set(reasons_by_task))
        return ChainStepAnalyticsResponse(
            start=range_start,
            end=range_end,
            tasks=[
                _summarise_task(name, served_counts_by_task.get(name, {}), reasons_by_task.get(name, []))
                for name in task_names
            ],
        )


def _summarise_task(
    task_name: str, served_counts_by_step: dict[int, int], fallback_reasons: list[FallbackReasonCount]
) -> TaskChainStepSummary:
    served_request_count = sum(served_counts_by_step.values())
    return TaskChainStepSummary(
        task_name=task_name,
        served_request_count=served_request_count,
        steps=[
            ChainStepShare(
                chain_step=chain_step,
                served_count=served_count,
                share=round(served_count / served_request_count, _SHARE_DIGITS),
            )
            for chain_step, served_count in sorted(served_counts_by_step.items())
        ],
        fallback_reasons=fallback_reasons,
    )
