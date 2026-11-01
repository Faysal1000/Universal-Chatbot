"""Task routes (ordered model chains), circuit breakers, and default-model administration."""

import logging
import re

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.identifiers import TASK_NAME_PATTERN
from app.persistence import configuration_repository
from app.persistence.tables import TaskRouteRecord, TaskRouteStepRecord
from app.routing.circuit_breaker import BreakerState, CircuitBreakerBoard
from app.routing.routing_catalog import RoutingCatalog
from app.schemas.routing import (
    BreakerStatusName,
    CircuitBreakerResetResponse,
    CircuitBreakerResponse,
    GatewaySettingsResponse,
    GatewaySettingsUpdateRequest,
    ModelChainRequest,
    TaskRouteCreateRequest,
    TaskRouteResponse,
    TaskRouteUpdateRequest,
)
from app.services.errors import InvalidReferenceError, ResourceConflictError, ResourceNotFoundError
from app.services.record_mappers import RouteDisplayContext, task_route_to_response
from app.services.task_model_compatibility import ensure_models_suit_task

logger = logging.getLogger(__name__)


class RoutingAdminService:
    """Use cases behind ``/admin/api/routes``, ``/admin/api/circuit-breakers`` and ``/admin/api/settings``."""

    def __init__(
        self,
        database_session: AsyncSession,
        routing_catalog: RoutingCatalog,
        circuit_breakers: CircuitBreakerBoard,
    ) -> None:
        self._database_session = database_session
        self._routing_catalog = routing_catalog
        self._circuit_breakers = circuit_breakers

    # ----- Task routes -----

    async def list_routes(self) -> list[TaskRouteResponse]:
        """All routes ordered by task name, each with its chain."""
        display_context = await self._display_context()
        return [
            task_route_to_response(task_route, display_context)
            for task_route in await configuration_repository.list_task_routes(self._database_session)
        ]

    async def get_route(self, task_name: str) -> TaskRouteResponse:
        """One route and its chain."""
        return await self._to_response(await self._require_route(task_name))

    async def create_route(self, create_request: TaskRouteCreateRequest) -> TaskRouteResponse:
        """Route a built-in task to a model chain."""
        if await configuration_repository.find_task_route(self._database_session, create_request.task_name):
            raise ResourceConflictError(f"Task route '{create_request.task_name}' already exists")
        await self._require_task(create_request.task_name)
        task_route = TaskRouteRecord(
            task_name=create_request.task_name,
            description=create_request.description,
            is_enabled=create_request.is_enabled,
        )
        await self._apply_chain(task_route, create_request)
        self._database_session.add(task_route)
        await self._commit()
        logger.info("Task route created", extra={"task_name": task_route.task_name})
        return await self.get_route(task_route.task_name)

    async def replace_chain(self, task_name: str, chain_request: ModelChainRequest) -> TaskRouteResponse:
        """Replace the route's whole chain in one transaction; creates the route if it is missing."""
        task_route = await configuration_repository.find_task_route(self._database_session, task_name)
        if task_route is None:
            if not re.fullmatch(TASK_NAME_PATTERN, task_name):
                raise InvalidReferenceError(f"'{task_name}' is not a valid task name")
            return await self.create_route(
                TaskRouteCreateRequest(task_name=task_name, **chain_request.model_dump())
            )
        task_route.steps.clear()
        # Old rows must be gone before new ones reuse their (task, position) and (task, model) keys.
        await self._database_session.flush()
        await self._apply_chain(task_route, chain_request)
        await self._commit()
        logger.info("Model chain replaced", extra={"task_name": task_name, "steps": len(chain_request.steps)})
        return await self.get_route(task_name)

    async def update_route(self, task_name: str, update_request: TaskRouteUpdateRequest) -> TaskRouteResponse:
        """Partial update of description, enable switch and ``append_default_model``."""
        task_route = await self._require_route(task_name)
        if "description" in update_request.model_fields_set:
            task_route.description = update_request.description
        if update_request.is_enabled is not None:
            task_route.is_enabled = update_request.is_enabled
        if update_request.append_default_model is not None:
            task_route.append_default_model = update_request.append_default_model
        await self._commit()
        return await self.get_route(task_name)

    async def delete_route(self, task_name: str) -> None:
        """Delete a route; the task is then served by the default model."""
        await self._database_session.delete(await self._require_route(task_name))
        await self._commit()

    # ----- Circuit breakers -----

    async def list_circuit_breakers(self) -> list[CircuitBreakerResponse]:
        """Models with recent consecutive failures (closed breakers without failures are omitted)."""
        model_names = await configuration_repository.load_qualified_model_names(self._database_session)
        return [_breaker_to_response(state, model_names) for state in self._circuit_breakers.states()]

    async def reset_circuit_breaker(self, model_pk: int) -> None:
        """Close one model's breaker so chains try it again at once."""
        if await configuration_repository.find_model(self._database_session, model_pk) is None:
            raise ResourceNotFoundError(f"Model {model_pk} not found")
        self._circuit_breakers.reset(model_pk)
        logger.info("Circuit breaker reset", extra={"model_pk": model_pk})

    def reset_all_circuit_breakers(self) -> CircuitBreakerResetResponse:
        """Close every breaker."""
        reset_count = self._circuit_breakers.reset_all()
        logger.info("All circuit breakers reset", extra={"reset_count": reset_count})
        return CircuitBreakerResetResponse(reset_count=reset_count)

    # ----- Default model -----

    async def get_settings(self) -> GatewaySettingsResponse:
        """The current default model."""
        gateway_settings = await configuration_repository.get_gateway_settings(self._database_session)
        default_model_pk = gateway_settings.default_model_pk
        model_names = await configuration_repository.load_qualified_model_names(self._database_session)
        return GatewaySettingsResponse(
            default_model_pk=default_model_pk,
            default_model_name=model_names.get(default_model_pk) if default_model_pk is not None else None,
        )

    async def update_settings(self, update_request: GatewaySettingsUpdateRequest) -> GatewaySettingsResponse:
        """Set (or clear) the default model used for unknown tasks and appended to chains."""
        await self._require_model_exists(update_request.default_model_pk)
        gateway_settings = await configuration_repository.get_gateway_settings(self._database_session)
        gateway_settings.default_model_pk = update_request.default_model_pk
        await self._commit()
        logger.info("Default model changed", extra={"default_model_pk": update_request.default_model_pk})
        return await self.get_settings()

    # ----- Internals -----

    async def _apply_chain(self, task_route: TaskRouteRecord, chain_request: ModelChainRequest) -> None:
        """Validate the chain's models and set the route's steps in list order."""
        model_pks = [step.model_pk for step in chain_request.steps]
        for model_pk in model_pks:
            await self._require_model_exists(model_pk)
        await ensure_models_suit_task(self._database_session, task_route.task_name, model_pks)
        task_route.append_default_model = chain_request.append_default_model
        task_route.steps = [
            TaskRouteStepRecord(
                position=position,
                model_pk=step.model_pk,
                max_attempts=step.max_attempts,
                timeout_seconds=step.timeout_seconds,
                is_enabled=step.is_enabled,
            )
            for position, step in enumerate(chain_request.steps, start=1)
        ]

    async def _require_route(self, task_name: str) -> TaskRouteRecord:
        task_route = await configuration_repository.find_task_route(self._database_session, task_name)
        if task_route is None:
            raise ResourceNotFoundError(f"Task route '{task_name}' not found")
        return task_route

    async def _require_task(self, task_name: str) -> None:
        if await configuration_repository.find_task(self._database_session, task_name) is None:
            raise InvalidReferenceError(f"Task '{task_name}' is not a built-in task")

    async def _require_model_exists(self, model_pk: int | None) -> None:
        if (
            model_pk is not None
            and await configuration_repository.find_model(self._database_session, model_pk) is None
        ):
            raise InvalidReferenceError(f"Model {model_pk} does not exist")

    async def _display_context(self) -> RouteDisplayContext:
        gateway_settings = await configuration_repository.get_gateway_settings(self._database_session)
        return RouteDisplayContext(
            model_names=await configuration_repository.load_qualified_model_names(self._database_session),
            default_model_pk=gateway_settings.default_model_pk,
            breaker_status_of=self._breaker_status_of,
        )

    def _breaker_status_of(self, model_pk: int) -> BreakerStatusName:
        breaker_state = self._circuit_breakers.state_of(model_pk)
        return breaker_state.status if breaker_state is not None else "closed"

    async def _to_response(self, task_route: TaskRouteRecord) -> TaskRouteResponse:
        await self._database_session.refresh(task_route)
        return task_route_to_response(task_route, await self._display_context())

    async def _commit(self) -> None:
        try:
            await self._database_session.commit()
        except IntegrityError as integrity_error:
            await self._database_session.rollback()
            raise ResourceConflictError("The change conflicts with existing data") from integrity_error
        self._routing_catalog.invalidate()


def _breaker_to_response(state: BreakerState, model_names: dict[int, str]) -> CircuitBreakerResponse:
    return CircuitBreakerResponse(
        model_pk=state.model_pk,
        model_name=model_names.get(state.model_pk, state.qualified_model_name),
        status=state.status,
        consecutive_failures=state.consecutive_failures,
        failure_threshold=state.failure_threshold,
        cooldown_seconds=state.cooldown_seconds,
        cooldown_remaining_seconds=state.cooldown_remaining_seconds,
        last_failure_at=state.last_failure_at,
        last_error_class=state.last_error_class,
        opened_count=state.opened_count,
    )
