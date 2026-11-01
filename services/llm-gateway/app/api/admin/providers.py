"""Admin API for providers and their models (``/admin/api/providers``, ``/admin/api/models``)."""

from fastapi import APIRouter, Response

from app.api.dependencies import (
    ADMIN_API_PATH_PREFIX,
    ADMIN_ROUTER_DEPENDENCIES,
    ProviderAdminServiceDependency,
    ProviderProbeServiceDependency,
)
from app.schemas.providers import (
    ConnectionTestResponse,
    DiscoveredModelResponse,
    ProviderCreateRequest,
    ProviderModelCreateRequest,
    ProviderModelResponse,
    ProviderModelUpdateRequest,
    ProviderResponse,
    ProviderUpdateRequest,
)

router = APIRouter(
    prefix=ADMIN_API_PATH_PREFIX, tags=["admin: providers"], dependencies=ADMIN_ROUTER_DEPENDENCIES
)


@router.get("/providers", response_model=list[ProviderResponse])
async def list_providers(provider_admin: ProviderAdminServiceDependency) -> list[ProviderResponse]:
    """All providers with their models, ordered by ID."""
    return await provider_admin.list_providers()


@router.post("/providers", response_model=ProviderResponse, status_code=201)
async def create_provider(
    create_request: ProviderCreateRequest, provider_admin: ProviderAdminServiceDependency
) -> ProviderResponse:
    """Register a provider. Its API key and header values are encrypted before storage."""
    return await provider_admin.create_provider(create_request)


@router.get("/providers/{provider_id}", response_model=ProviderResponse)
async def get_provider(provider_id: str, provider_admin: ProviderAdminServiceDependency) -> ProviderResponse:
    """One provider with its models."""
    return await provider_admin.get_provider(provider_id)


@router.patch("/providers/{provider_id}", response_model=ProviderResponse)
async def update_provider(
    provider_id: str, update_request: ProviderUpdateRequest, provider_admin: ProviderAdminServiceDependency
) -> ProviderResponse:
    """Partial update; see :class:`ProviderUpdateRequest` for secret semantics."""
    return await provider_admin.update_provider(provider_id, update_request)


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(provider_id: str, provider_admin: ProviderAdminServiceDependency) -> Response:
    """Delete a provider and its models, unless one of them is still routed to (409)."""
    await provider_admin.delete_provider(provider_id)
    return Response(status_code=204)


@router.post("/providers/{provider_id}/discover-models", response_model=list[DiscoveredModelResponse])
async def discover_models(
    provider_id: str,
    provider_admin: ProviderAdminServiceDependency,
    provider_probe: ProviderProbeServiceDependency,
) -> list[DiscoveredModelResponse]:
    """Call the provider's models endpoint (nothing is saved)."""
    return await provider_probe.discover_models(await provider_admin.require_provider(provider_id))


@router.post("/providers/{provider_id}/models", response_model=ProviderModelResponse, status_code=201)
async def create_model(
    provider_id: str,
    create_request: ProviderModelCreateRequest,
    provider_admin: ProviderAdminServiceDependency,
) -> ProviderModelResponse:
    """Add a model to a provider."""
    return await provider_admin.create_model(provider_id, create_request)


@router.patch("/models/{model_pk}", response_model=ProviderModelResponse)
async def update_model(
    model_pk: int, update_request: ProviderModelUpdateRequest, provider_admin: ProviderAdminServiceDependency
) -> ProviderModelResponse:
    """Partial update; explicitly sent ``null`` clears optional fields."""
    return await provider_admin.update_model(model_pk, update_request)


@router.delete("/models/{model_pk}", status_code=204)
async def delete_model(model_pk: int, provider_admin: ProviderAdminServiceDependency) -> Response:
    """Delete a model unless a task route or the default-model setting uses it (409)."""
    await provider_admin.delete_model(model_pk)
    return Response(status_code=204)


@router.post("/models/{model_pk}/test", response_model=ConnectionTestResponse)
async def test_model(
    model_pk: int,
    provider_admin: ProviderAdminServiceDependency,
    provider_probe: ProviderProbeServiceDependency,
) -> ConnectionTestResponse:
    """Send a tiny real request to the model (works for disabled models; not recorded)."""
    provider_model = await provider_admin.require_model(model_pk)
    provider = await provider_admin.require_provider(provider_model.provider_id)
    return await provider_probe.test_model(provider, provider_model)
