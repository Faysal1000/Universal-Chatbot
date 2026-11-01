"""Reads of the configuration tables: providers, models, tasks, task routes, gateway settings.

Writes go through the ORM session in the admin services (add / delete / commit); this
module keeps every query in one place so services never build SQL themselves.
"""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.persistence.tables import (
    GatewaySettingsRecord,
    ProviderModelRecord,
    ProviderRecord,
    TaskRecord,
    TaskRouteRecord,
    TaskRouteStepRecord,
)

GATEWAY_SETTINGS_ROW_ID = 1


async def list_providers(database_session: AsyncSession) -> Sequence[ProviderRecord]:
    """Every provider with its models (eager-loaded), ordered by ID."""
    return (await database_session.scalars(select(ProviderRecord).order_by(ProviderRecord.provider_id))).all()


async def find_provider(database_session: AsyncSession, provider_id: str) -> ProviderRecord | None:
    """The provider with this ID, or ``None``."""
    return await database_session.get(ProviderRecord, provider_id)


async def find_model(database_session: AsyncSession, model_pk: int) -> ProviderModelRecord | None:
    """The model with this numeric key, or ``None``."""
    return await database_session.get(ProviderModelRecord, model_pk)


async def load_qualified_model_names(database_session: AsyncSession) -> dict[int, str]:
    """``{model_pk: "provider_id/model_id"}`` for every model."""
    model_rows = await database_session.execute(
        select(ProviderModelRecord.id, ProviderModelRecord.provider_id, ProviderModelRecord.model_id)
    )
    return {model_pk: f"{provider_id}/{model_id}" for model_pk, provider_id, model_id in model_rows.all()}


async def find_model_by_name(
    database_session: AsyncSession, provider_id: str, model_id: str
) -> ProviderModelRecord | None:
    """The model ``provider_id/model_id``, or ``None``."""
    return await database_session.scalar(
        select(ProviderModelRecord).where(
            ProviderModelRecord.provider_id == provider_id, ProviderModelRecord.model_id == model_id
        )
    )


async def list_tasks(database_session: AsyncSession) -> Sequence[TaskRecord]:
    """The task catalog ordered by task name."""
    return (await database_session.scalars(select(TaskRecord).order_by(TaskRecord.task_name))).all()


async def find_task(database_session: AsyncSession, task_name: str) -> TaskRecord | None:
    """The catalog entry for ``task_name``, or ``None``."""
    return await database_session.get(TaskRecord, task_name)


async def list_task_routes(database_session: AsyncSession) -> Sequence[TaskRouteRecord]:
    """Every task route ordered by task name."""
    return (await database_session.scalars(select(TaskRouteRecord).order_by(TaskRouteRecord.task_name))).all()


async def find_task_route(database_session: AsyncSession, task_name: str) -> TaskRouteRecord | None:
    """The route for ``task_name``, or ``None``."""
    return await database_session.get(TaskRouteRecord, task_name)


async def list_task_names_using_models(database_session: AsyncSession, model_pks: list[int]) -> list[str]:
    """Task routes with a chain step on one of ``model_pks``."""
    if not model_pks:
        return []
    task_names = await database_session.scalars(
        select(TaskRouteStepRecord.task_name).where(TaskRouteStepRecord.model_pk.in_(model_pks)).distinct()
    )
    return list(task_names)


async def list_vision_task_names_using_model(database_session: AsyncSession, model_pk: int) -> list[str]:
    """Routed tasks that require vision and have a chain step on ``model_pk``."""
    task_names = await database_session.scalars(
        select(TaskRouteStepRecord.task_name)
        .join(TaskRecord, TaskRecord.task_name == TaskRouteStepRecord.task_name)
        .where(TaskRecord.requires_vision, TaskRouteStepRecord.model_pk == model_pk)
        .distinct()
    )
    return list(task_names)


async def get_gateway_settings(database_session: AsyncSession) -> GatewaySettingsRecord:
    """The single settings row, created (unsaved) if the migration's seed row is missing."""
    gateway_settings = await database_session.get(GatewaySettingsRecord, GATEWAY_SETTINGS_ROW_ID)
    if gateway_settings is None:
        gateway_settings = GatewaySettingsRecord(singleton_id=GATEWAY_SETTINGS_ROW_ID)
        database_session.add(gateway_settings)
    return gateway_settings
