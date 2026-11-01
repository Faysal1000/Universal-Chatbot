"""Per-deployment admission control: a concurrency limit plus a bounded waiting queue.

Beyond ``max_waiting`` queued requests, callers get 503 with ``Retry-After`` at once
instead of piling up; llm-gateway retries them or falls back to another model.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from app.errors import ServiceAtCapacityError


class DeploymentAdmission:
    """Limits how many requests run (``concurrency``) and wait (``max_waiting``) per deployment."""

    def __init__(self, concurrency: int, max_waiting: int) -> None:
        self._slots = asyncio.Semaphore(concurrency)
        self._concurrency = concurrency
        self._max_waiting = max_waiting
        self._admitted_count = 0

    @property
    def in_flight_count(self) -> int:
        """Requests running or waiting for a slot."""
        return self._admitted_count

    @property
    def waiting_count(self) -> int:
        """Requests waiting for a slot."""
        return max(0, self._admitted_count - self._concurrency)

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        """Hold a generation slot for the duration of the block, or raise if the queue is full."""
        if self._admitted_count >= self._concurrency + self._max_waiting:
            raise ServiceAtCapacityError()
        self._admitted_count += 1
        try:
            async with self._slots:
                yield
        finally:
            self._admitted_count -= 1
