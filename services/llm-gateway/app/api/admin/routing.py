"""Admin API for task routes and their model chains, circuit breakers, and the default model."""

from fastapi import APIRouter, Response

from app.api.dependencies import (
    ADMIN_API_PATH_PREFIX,
    ADMIN_ROUTER_DEPENDENCIES,
    RoutingAdminServiceDependency,
)
from app.schemas.routing import (
    CircuitBreakerResetResponse,
    CircuitBreakerResponse,
    GatewaySettingsResponse,
    GatewaySettingsUpdateRequest,
    ModelChainRequest,
    TaskRouteCreateRequest,
    TaskRouteResponse,
    TaskRouteUpdateRequest,
)

router = APIRouter(
    prefix=ADMIN_API_PATH_PREFIX, tags=["admin: routing"], dependencies=ADMIN_ROUTER_DEPENDENCIES
)


@router.get("/routes", response_model=list[TaskRouteResponse])
async def list_routes(routing_admin: RoutingAdminServiceDependency) -> list[TaskRouteResponse]:
    """All task routes ordered by task name, each with its ordered model chain."""
    return await routing_admin.list_routes()


@router.post("/routes", response_model=TaskRouteResponse, status_code=201)
async def create_route(
    create_request: TaskRouteCreateRequest, routing_admin: RoutingAdminServiceDependency
) -> TaskRouteResponse:
    """Route a task name to an ordered chain of 1-10 model steps."""
    return await routing_admin.create_route(create_request)


@router.get("/routes/{task_name}", response_model=TaskRouteResponse)
async def get_route(task_name: str, routing_admin: RoutingAdminServiceDependency) -> TaskRouteResponse:
    """One task route with its chain and each step's circuit-breaker status."""
    return await routing_admin.get_route(task_name)


@router.get("/routes/{task_name}/chain", response_model=TaskRouteResponse)
async def get_chain(task_name: str, routing_admin: RoutingAdminServiceDependency) -> TaskRouteResponse:
    """The task's model chain in order (same body as GET /routes/{task_name})."""
    return await routing_admin.get_route(task_name)


@router.put("/routes/{task_name}/chain", response_model=TaskRouteResponse)
async def replace_chain(
    task_name: str, chain_request: ModelChainRequest, routing_admin: RoutingAdminServiceDependency
) -> TaskRouteResponse:
    """Replace the whole chain atomically (creates the route if missing). Steps run in list order."""
    return await routing_admin.replace_chain(task_name, chain_request)


@router.patch("/routes/{task_name}", response_model=TaskRouteResponse)
async def update_route(
    task_name: str, update_request: TaskRouteUpdateRequest, routing_admin: RoutingAdminServiceDependency
) -> TaskRouteResponse:
    """Partial update of description, enable switch and ``append_default_model``."""
    return await routing_admin.update_route(task_name, update_request)


@router.delete("/routes/{task_name}", status_code=204)
async def delete_route(task_name: str, routing_admin: RoutingAdminServiceDependency) -> Response:
    """Delete a route; the task is then served by the default model."""
    await routing_admin.delete_route(task_name)
    return Response(status_code=204)


@router.get("/circuit-breakers", response_model=list[CircuitBreakerResponse])
async def list_circuit_breakers(routing_admin: RoutingAdminServiceDependency) -> list[CircuitBreakerResponse]:
    """Models with recent consecutive failures and whether chains currently skip them."""
    return await routing_admin.list_circuit_breakers()


@router.post("/circuit-breakers/reset", response_model=CircuitBreakerResetResponse)
async def reset_all_circuit_breakers(
    routing_admin: RoutingAdminServiceDependency,
) -> CircuitBreakerResetResponse:
    """Close every breaker."""
    return routing_admin.reset_all_circuit_breakers()


@router.post("/circuit-breakers/{model_pk}/reset", status_code=204)
async def reset_circuit_breaker(model_pk: int, routing_admin: RoutingAdminServiceDependency) -> Response:
    """Close one model's breaker so chains try it again at once."""
    await routing_admin.reset_circuit_breaker(model_pk)
    return Response(status_code=204)


@router.get("/settings", response_model=GatewaySettingsResponse)
async def get_gateway_settings(routing_admin: RoutingAdminServiceDependency) -> GatewaySettingsResponse:
    """The current default model."""
    return await routing_admin.get_settings()


@router.put("/settings", response_model=GatewaySettingsResponse)
async def update_gateway_settings(
    update_request: GatewaySettingsUpdateRequest, routing_admin: RoutingAdminServiceDependency
) -> GatewaySettingsResponse:
    """Set (or clear) the default model used for unknown tasks and appended to chains."""
    return await routing_admin.update_settings(update_request)
