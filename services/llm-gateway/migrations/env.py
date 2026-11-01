"""Alembic environment: runs migrations over the async asyncpg engine.

Only ``LLM_GATEWAY_DATABASE_URL`` is needed, so migrations can run as a one-shot job
without the gateway's other secrets.
"""

import asyncio
import os
import re
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.persistence.tables import TableBase

alembic_config = context.config
if alembic_config.config_file_name is not None:
    fileConfig(alembic_config.config_file_name)

target_metadata = TableBase.metadata

# Monthly ``request_metrics_YYYY_MM`` partitions are created and dropped at runtime
# (see ``app.persistence.partitions``), so autogenerate must not treat them as drift.
_RUNTIME_PARTITION_NAME = re.compile(r"^request_metrics_\d{4}_\d{2}(_|$)")


def _include_object(
    schema_object: object, name: str | None, type_: str, reflected: bool, compare_to: object
) -> bool:
    del schema_object, type_, compare_to
    return not (reflected and name is not None and _RUNTIME_PARTITION_NAME.match(name))


def _database_url() -> str:
    database_url = os.environ.get("LLM_GATEWAY_DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("LLM_GATEWAY_DATABASE_URL must be set to run migrations")
    return database_url


def _run_migrations_on_connection(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_migrations_online() -> None:
    engine = create_async_engine(_database_url())
    async with engine.connect() as connection:
        await connection.run_sync(_run_migrations_on_connection)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(url=_database_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(_run_migrations_online())
