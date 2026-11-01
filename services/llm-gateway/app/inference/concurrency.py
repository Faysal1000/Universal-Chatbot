"""Bounded concurrency per provider, sized by each provider's ``max_concurrent_requests``."""

import asyncio
import contextlib
from collections.abc import AsyncIterator

from app.core.errors import GatewayAtCapacityError
from app.protocols.types import UpstreamTarget


class ProviderConcurrencyLimiter:
    """Per-provider semaphores sized by each provider's ``max_concurrent_requests``."""

    def __init__(self, wait_timeout_seconds: float) -> None:
        self._wait_timeout_seconds = wait_timeout_seconds
        self._semaphores_by_provider: dict[str, tuple[int, asyncio.Semaphore]] = {}

    @contextlib.asynccontextmanager
    async def slot(self, target: UpstreamTarget) -> AsyncIterator[None]:
        """Hold one of the provider's slots for the duration of the block."""
        semaphore = self._semaphore_for(target)
        try:
            async with asyncio.timeout(self._wait_timeout_seconds):
                await semaphore.acquire()
        except TimeoutError as timeout_error:
            raise GatewayAtCapacityError() from timeout_error
        try:
            yield
        finally:
            semaphore.release()

    def _semaphore_for(self, target: UpstreamTarget) -> asyncio.Semaphore:
        configured_limit = target.max_concurrent_requests
        existing_entry = self._semaphores_by_provider.get(target.provider_id)
        if existing_entry is None or existing_entry[0] != configured_limit:
            # A resized limit takes effect for new requests; in-flight ones finish on the old one.
            existing_entry = (configured_limit, asyncio.Semaphore(configured_limit))
            self._semaphores_by_provider[target.provider_id] = existing_entry
        return existing_entry[1]
