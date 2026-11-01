"""TTL-cached routing configuration so the request hot path does no database I/O.

The snapshot is cached for ``routing_cache_ttl_seconds`` and invalidated immediately on
admin writes in this process (other replicas pick changes up within the TTL).
"""

import asyncio
import logging
import time

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.routing.provider_registry import load_routing_snapshot
from app.routing.task_routes import RoutingSnapshot
from app.security.secret_cipher import SecretCipher

logger = logging.getLogger(__name__)


class RoutingCatalog:
    """TTL-cached :class:`RoutingSnapshot` with single-flight reloads."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        cipher: SecretCipher,
        cache_ttl_seconds: float,
    ) -> None:
        self._session_factory = session_factory
        self._cipher = cipher
        self._cache_ttl_seconds = cache_ttl_seconds
        self._snapshot: RoutingSnapshot | None = None
        self._snapshot_loaded_at_monotonic = 0.0
        self._generation = 0
        self._reload_lock = asyncio.Lock()

    async def current_snapshot(self) -> RoutingSnapshot:
        """Return a fresh-enough snapshot, reloading at most once per TTL across callers."""
        if self._is_fresh():
            assert self._snapshot is not None  # noqa: S101 - narrowed by _is_fresh().
            return self._snapshot
        async with self._reload_lock:
            if not self._is_fresh():
                await self._reload()
            assert self._snapshot is not None  # noqa: S101 - loaded or kept by _reload().
            return self._snapshot

    def invalidate(self) -> None:
        """Force the next request to reload (called after every admin configuration write)."""
        self._snapshot_loaded_at_monotonic = float("-inf")
        self._generation += 1

    async def _reload(self) -> None:
        """Load a new snapshot; if the database fails, keep serving the last one for another TTL."""
        started_generation = self._generation
        try:
            async with self._session_factory() as session:
                snapshot = await load_routing_snapshot(session, self._cipher)
        except Exception:
            if self._snapshot is None:
                raise
            logger.exception("Could not reload the routing configuration; serving the last one")
            self._snapshot_loaded_at_monotonic = time.monotonic()
            return
        self._snapshot = snapshot
        # An invalidate() during the load may have changed what the database holds, so reload again.
        if self._generation == started_generation:
            self._snapshot_loaded_at_monotonic = time.monotonic()

    def _is_fresh(self) -> bool:
        return (
            self._snapshot is not None
            and time.monotonic() - self._snapshot_loaded_at_monotonic < self._cache_ttl_seconds
        )
