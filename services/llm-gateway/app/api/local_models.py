"""Machine API for ``services/local-llm``: register deployments and report them unavailable.

Authenticated with ``LLM_GATEWAY_REGISTRATION_API_KEY`` (``Authorization: Bearer`` or
``X-API-Key``), never with the caller key. Every call is idempotent.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response

from app.api.dependencies import LocalModelRegistryServiceDependency, require_registration_api_key
from app.core.identifiers import DEPLOYMENT_NAME_PATTERN
from app.schemas.local_models import (
    LocalModelDeploymentResponse,
    LocalModelRegistrationRequest,
    LocalModelRegistrationResponse,
)

router = APIRouter(
    prefix="/v1/local-models",
    tags=["local models (machine registration)"],
    dependencies=[Depends(require_registration_api_key)],
)

DeploymentName = Annotated[
    str,
    Path(pattern=DEPLOYMENT_NAME_PATTERN, description="Deployment name, also the model ID sent upstream"),
]


@router.get("", response_model=list[LocalModelDeploymentResponse])
async def list_local_models(
    registry: LocalModelRegistryServiceDependency,
) -> list[LocalModelDeploymentResponse]:
    """Every registered deployment, for reconciliation after local-llm restarts."""
    return await registry.list_deployments()


@router.put(
    "/{deployment_name}",
    response_model=LocalModelRegistrationResponse,
    responses={
        201: {"description": "Registered for the first time"},
        409: {"description": "Would remove vision from a model routed for a vision task"},
        422: {"description": "Invalid payload, unknown default task, or a vision task without vision"},
    },
)
async def register_local_model(
    deployment_name: DeploymentName,
    registration: LocalModelRegistrationRequest,
    registry: LocalModelRegistryServiceDependency,
    response: Response,
) -> LocalModelRegistrationResponse:
    """Register or update a ready deployment and mark it available (200 on update, 201 on create)."""
    registration_result = await registry.register(deployment_name, registration)
    if registration_result.was_created:
        response.status_code = 201
    return registration_result


@router.post(
    "/{deployment_name}/unavailable",
    response_model=LocalModelDeploymentResponse,
    responses={404: {"description": "The deployment was never registered"}},
)
async def mark_local_model_unavailable(
    deployment_name: DeploymentName, registry: LocalModelRegistryServiceDependency
) -> LocalModelDeploymentResponse:
    """Stop routing to the deployment (unloaded or failed); register it again to resume."""
    return await registry.mark_unavailable(deployment_name)
