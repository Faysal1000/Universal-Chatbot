"""Monthly range partitions of ``request_metrics``: created ahead, dropped after retention."""

import logging
import re
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger(__name__)

METRICS_PARENT_TABLE = "request_metrics"
_PARTITION_NAME_PATTERN = re.compile(r"^request_metrics_(\d{4})_(\d{2})$")
# Partitions are created this many months ahead so inserts never hit a missing range.
MONTHS_OF_PARTITIONS_CREATED_AHEAD = 2


def _first_day_of_month(any_day: date) -> date:
    return any_day.replace(day=1)


def _add_months(month_start: date, month_count: int) -> date:
    month_index = month_start.year * 12 + (month_start.month - 1) + month_count
    return date(month_index // 12, month_index % 12 + 1, 1)


def monthly_partition_name(month_start: date) -> str:
    """Return the partition table name for the month starting at ``month_start``."""
    return f"{METRICS_PARENT_TABLE}_{month_start.year:04d}_{month_start.month:02d}"


async def ensure_metric_partitions(engine: AsyncEngine, today: date | None = None) -> list[str]:
    """Create the current month's partition and the next few; return names created.

    ``CREATE TABLE IF NOT EXISTS ... PARTITION OF`` is idempotent, so concurrent
    gateway replicas may run this safely.
    """
    current_month = _first_day_of_month(today or datetime.now(UTC).date())
    created_partition_names: list[str] = []
    async with engine.begin() as connection:
        for month_offset in range(MONTHS_OF_PARTITIONS_CREATED_AHEAD + 1):
            month_start = _add_months(current_month, month_offset)
            next_month_start = _add_months(month_start, 1)
            partition_name = monthly_partition_name(month_start)
            already_exists = await connection.scalar(
                text("SELECT to_regclass(:partition_name) IS NOT NULL"), {"partition_name": partition_name}
            )
            if already_exists:
                continue
            # Identifiers come from formatted dates only, never from user input.
            await connection.execute(
                text(
                    f"CREATE TABLE IF NOT EXISTS {partition_name} PARTITION OF {METRICS_PARENT_TABLE} "
                    f"FOR VALUES FROM ('{month_start.isoformat()}') TO ('{next_month_start.isoformat()}')"
                )
            )
            created_partition_names.append(partition_name)
    if created_partition_names:
        logger.info("Created request metric partitions", extra={"partitions": created_partition_names})
    return created_partition_names


async def drop_expired_metric_partitions(
    engine: AsyncEngine, retention_days: int, today: date | None = None
) -> list[str]:
    """Drop whole monthly partitions whose newest possible row is older than the retention.

    Dropping a partition is instant and leaves no table bloat, unlike ``DELETE``.
    """
    retention_cutoff = (today or datetime.now(UTC).date()) - timedelta(days=retention_days)
    dropped_partition_names: list[str] = []
    async with engine.begin() as connection:
        partition_rows = await connection.execute(
            text(
                "SELECT child.relname FROM pg_inherits "
                "JOIN pg_class parent ON pg_inherits.inhparent = parent.oid "
                "JOIN pg_class child ON pg_inherits.inhrelid = child.oid "
                "WHERE parent.relname = :parent_table"
            ),
            {"parent_table": METRICS_PARENT_TABLE},
        )
        for (partition_name,) in partition_rows.all():
            name_match = _PARTITION_NAME_PATTERN.fullmatch(partition_name)
            if name_match is None:
                continue
            month_start = date(int(name_match.group(1)), int(name_match.group(2)), 1)
            if _add_months(month_start, 1) <= retention_cutoff:
                await connection.execute(text(f"DROP TABLE IF EXISTS {partition_name}"))
                dropped_partition_names.append(partition_name)
    if dropped_partition_names:
        logger.info(
            "Dropped expired request metric partitions", extra={"partitions": dropped_partition_names}
        )
    return dropped_partition_names
