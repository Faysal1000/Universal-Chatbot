"""Buffered, non-blocking writer of per-request metrics to Postgres.

The request path only calls :meth:`MetricsRecorder.record`, which is synchronous and
never waits on the database: rows go into a bounded in-memory queue and a background
task inserts them in batches. If Postgres is down for long enough to fill the queue,
new rows are dropped and logged rather than slowing down or failing LLM traffic.
"""

import asyncio
import contextlib
import logging
from dataclasses import asdict

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

from app.metrics.request_metric import RequestMetric
from app.persistence.partitions import ensure_metric_partitions
from app.persistence.request_metrics_repository import insert_request_metrics

logger = logging.getLogger(__name__)


class MetricsRecorder:
    """Owns the background flush task; start with :meth:`start`, stop with :meth:`stop`."""

    def __init__(
        self,
        engine: AsyncEngine,
        write_batch_size: int,
        flush_interval_seconds: float,
        queue_capacity: int,
    ) -> None:
        self._engine = engine
        self._write_batch_size = write_batch_size
        self._flush_interval_seconds = flush_interval_seconds
        self._pending_metrics: asyncio.Queue[RequestMetric] = asyncio.Queue(maxsize=queue_capacity)
        self._flush_task: asyncio.Task[None] | None = None

    def record(self, request_metric: RequestMetric) -> None:
        """Queue a row. Never blocks, never raises."""
        try:
            self._pending_metrics.put_nowait(request_metric)
        except asyncio.QueueFull:
            logger.warning("Request metrics queue is full; dropping a row")

    def start(self) -> None:
        """Start the background writer."""
        self._flush_task = asyncio.create_task(self._flush_forever(), name="metrics-recorder")

    async def stop(self, drain_timeout_seconds: float) -> None:
        """Stop the writer and try to persist everything still queued."""
        if self._flush_task is not None:
            self._flush_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._flush_task
            self._flush_task = None
        try:
            async with asyncio.timeout(drain_timeout_seconds):
                while not self._pending_metrics.empty():
                    await self._write_batch(self._take_batch())
        except TimeoutError:
            remaining_rows = self._pending_metrics.qsize()
            logger.warning("Dropped unwritten request metrics at shutdown", extra={"rows": remaining_rows})

    async def _flush_forever(self) -> None:
        while True:
            first_metric = await self._pending_metrics.get()
            # Let a burst accumulate briefly so inserts are batched.
            try:
                await asyncio.sleep(self._flush_interval_seconds)
            except asyncio.CancelledError:
                # Shutting down: hand the row back so stop() writes it with the rest.
                with contextlib.suppress(asyncio.QueueFull):
                    self._pending_metrics.put_nowait(first_metric)
                raise
            await self._write_batch([first_metric, *self._take_batch(self._write_batch_size - 1)])

    def _take_batch(self, max_rows: int | None = None) -> list[RequestMetric]:
        row_limit = max_rows if max_rows is not None else self._write_batch_size
        batch: list[RequestMetric] = []
        while len(batch) < row_limit and not self._pending_metrics.empty():
            batch.append(self._pending_metrics.get_nowait())
        return batch

    async def _write_batch(self, batch: list[RequestMetric]) -> None:
        if not batch:
            return
        row_values = [asdict(request_metric) for request_metric in batch]
        for attempt_number in (1, 2):
            try:
                async with self._engine.begin() as connection:
                    await insert_request_metrics(connection, row_values)
                return
            except (SQLAlchemyError, OSError):
                if attempt_number == 1:
                    # The most likely cause is a missing future partition; create it and retry.
                    with contextlib.suppress(SQLAlchemyError, OSError):
                        await ensure_metric_partitions(self._engine)
                    continue
                logger.exception("Failed to write request metrics", extra={"rows": len(batch)})
