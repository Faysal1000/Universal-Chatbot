"""Construction and teardown of the long-lived objects shared by every request."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app import __version__
from app.core.config import Settings
from app.inference.completion_service import CompletionService
from app.metrics.recorder import MetricsRecorder
from app.persistence.database import create_database_engine, create_session_factory
from app.persistence.partitions import drop_expired_metric_partitions, ensure_metric_partitions
from app.routing.circuit_breaker import CircuitBreakerBoard
from app.routing.routing_catalog import RoutingCatalog
from app.security.admin_sessions import AdminSessionSigner
from app.security.login_throttle import LoginAttemptLimiter
from app.security.secret_cipher import SecretCipher

logger = logging.getLogger(__name__)

PARTITION_MAINTENANCE_INTERVAL_SECONDS = 6 * 3600


@dataclass(frozen=True, slots=True)
class GatewayRuntime:
    """Everything that exists only between successful startup and shutdown."""

    settings: Settings
    database_engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    secret_cipher: SecretCipher
    routing_catalog: RoutingCatalog
    metrics_recorder: MetricsRecorder
    http_client: httpx.AsyncClient
    circuit_breakers: CircuitBreakerBoard
    completion_service: CompletionService
    admin_session_signer: AdminSessionSigner
    login_attempt_limiter: LoginAttemptLimiter


@contextlib.asynccontextmanager
async def open_gateway_runtime(
    settings: Settings, upstream_transport: httpx.AsyncBaseTransport | None = None
) -> AsyncIterator[GatewayRuntime]:
    """Start every long-lived component, yield the runtime, then shut down in reverse order.

    Fails fast if Postgres is unreachable or unmigrated, so the orchestrator restarts the gateway.
    """
    database_engine = create_database_engine(settings)
    await ensure_metric_partitions(database_engine)
    await drop_expired_metric_partitions(database_engine, settings.metrics_retention_days)

    secret_cipher = SecretCipher(settings.encryption_key.get_secret_value())
    session_factory = create_session_factory(database_engine)
    metrics_recorder = MetricsRecorder(
        database_engine,
        write_batch_size=settings.metrics_write_batch_size,
        flush_interval_seconds=settings.metrics_flush_interval_seconds,
        queue_capacity=settings.metrics_write_queue_capacity,
    )
    http_client = httpx.AsyncClient(
        transport=upstream_transport,
        limits=httpx.Limits(
            max_connections=settings.upstream_max_connections,
            max_keepalive_connections=min(settings.upstream_max_connections, 100),
        ),
        follow_redirects=False,
        headers={"User-Agent": f"llm-gateway/{__version__}"},
    )
    circuit_breakers = CircuitBreakerBoard(
        settings.circuit_breaker_failure_threshold, settings.circuit_breaker_cooldown_seconds
    )
    runtime = GatewayRuntime(
        settings=settings,
        database_engine=database_engine,
        session_factory=session_factory,
        secret_cipher=secret_cipher,
        routing_catalog=RoutingCatalog(session_factory, secret_cipher, settings.routing_cache_ttl_seconds),
        metrics_recorder=metrics_recorder,
        http_client=http_client,
        circuit_breakers=circuit_breakers,
        completion_service=CompletionService(settings, http_client, metrics_recorder, circuit_breakers),
        admin_session_signer=AdminSessionSigner(
            settings.admin_session_secret.get_secret_value(), settings.admin_session_ttl_seconds
        ),
        login_attempt_limiter=LoginAttemptLimiter(settings.admin_login_max_failures_per_minute),
    )
    metrics_recorder.start()
    partition_maintenance = asyncio.create_task(
        _maintain_metric_partitions(runtime), name="partition-maintenance"
    )
    try:
        yield runtime
    finally:
        partition_maintenance.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await partition_maintenance
        await metrics_recorder.stop(drain_timeout_seconds=settings.graceful_shutdown_timeout_seconds)
        await http_client.aclose()
        await database_engine.dispose()


async def _maintain_metric_partitions(runtime: GatewayRuntime) -> None:
    """Create upcoming monthly partitions and drop expired ones, forever."""
    while True:
        await asyncio.sleep(PARTITION_MAINTENANCE_INTERVAL_SECONDS)
        try:
            await ensure_metric_partitions(runtime.database_engine)
            await drop_expired_metric_partitions(
                runtime.database_engine, runtime.settings.metrics_retention_days
            )
        except Exception:
            logger.exception("Request metric partition maintenance failed; retrying next cycle")
