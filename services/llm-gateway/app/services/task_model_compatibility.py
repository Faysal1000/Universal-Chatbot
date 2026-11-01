"""Keeps task routes consistent with what their tasks need: vision tasks get vision models.

Every write that could break the rule checks it here: creating or changing a route,
and removing a model's vision capability.
"""

from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.model_capabilities import VISION_CAPABILITY
from app.persistence import configuration_repository
from app.persistence.tables import ProviderModelRecord
from app.services.errors import InvalidReferenceError, ResourceConflictError


def model_has_vision(provider_model: ProviderModelRecord) -> bool:
    """Whether the model declares the ``vision`` capability."""
    return VISION_CAPABILITY in provider_model.capabilities


async def ensure_models_suit_task(
    database_session: AsyncSession, task_name: str, model_pks: Sequence[int]
) -> None:
    """Reject routing a vision task to a model without vision (422)."""
    task = await configuration_repository.find_task(database_session, task_name)
    if task is None or not task.requires_vision:
        return
    for model_pk in model_pks:
        provider_model = await configuration_repository.find_model(database_session, model_pk)
        if provider_model is not None and not model_has_vision(provider_model):
            raise InvalidReferenceError(
                f"Task '{task_name}' requires vision, but model "
                f"'{provider_model.provider_id}/{provider_model.model_id}' has no vision capability"
            )


async def ensure_vision_can_be_removed(
    database_session: AsyncSession, provider_model: ProviderModelRecord
) -> None:
    """A model routed for a vision task must keep its vision capability (409)."""
    vision_task_names = await configuration_repository.list_vision_task_names_using_model(
        database_session, provider_model.id
    )
    if vision_task_names:
        raise ResourceConflictError(
            f"Model '{provider_model.provider_id}/{provider_model.model_id}' must keep vision: "
            f"vision tasks {', '.join(sorted(vision_task_names))} are routed to it"
        )
