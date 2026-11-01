"""Async engine and session factory for the gateway's own database (``llm_gateway``)."""

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings


def create_database_engine(settings: Settings) -> AsyncEngine:
    """Create the pooled asyncpg engine. ``pool_pre_ping`` survives Postgres restarts."""
    return create_async_engine(
        settings.database_url.get_secret_value(),
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args={"server_settings": {"application_name": "llm-gateway"}},
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Sessions keep loaded objects usable after commit (API handlers serialise them)."""
    return async_sessionmaker(engine, expire_on_commit=False)
