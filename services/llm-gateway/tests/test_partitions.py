"""Monthly partition creation and retention for ``request_metrics``."""

from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.persistence.partitions import (
    drop_expired_metric_partitions,
    ensure_metric_partitions,
    monthly_partition_name,
)


async def _partition_names(database_url: str) -> set[str]:
    engine = create_async_engine(database_url)
    async with engine.connect() as connection:
        rows = await connection.execute(
            text(
                "SELECT child.relname FROM pg_inherits JOIN pg_class parent ON inhparent = parent.oid "
                "JOIN pg_class child ON inhrelid = child.oid WHERE parent.relname = 'request_metrics'"
            )
        )
        partition_names = {row[0] for row in rows}
    await engine.dispose()
    return partition_names


def test_partition_naming() -> None:
    assert monthly_partition_name(date(2026, 1, 1)) == "request_metrics_2026_01"


async def test_partitions_are_created_ahead_and_dropped_after_retention(test_database_url: str) -> None:
    engine = create_async_engine(test_database_url)
    created = await ensure_metric_partitions(engine, today=date(2020, 11, 15))
    assert created == ["request_metrics_2020_11", "request_metrics_2020_12", "request_metrics_2021_01"]
    assert await ensure_metric_partitions(engine, today=date(2020, 11, 15)) == [], "idempotent"

    dropped = await drop_expired_metric_partitions(engine, retention_days=31, today=date(2021, 1, 20))
    assert dropped == ["request_metrics_2020_11"], "December still holds rows newer than the cutoff"
    remaining = await _partition_names(test_database_url)
    assert "request_metrics_2020_12" in remaining
    await drop_expired_metric_partitions(engine, retention_days=31, today=date(2021, 6, 1))
    await engine.dispose()
