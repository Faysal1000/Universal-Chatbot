"""FastAPI dependencies: runtime access, database sessions, services, and authentication."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AuthenticationFailedError, GatewayNotReadyError
from app.runtime import GatewayRuntime
from app.security.admin_sessions import AdminSession
from app.security.caller_api_keys import extract_caller_api_key, is_valid_caller_api_key
from app.services.analytics_service import AnalyticsService
from app.services.chain_analytics_service import ChainAnalyticsService
from app.services.local_model_registry_service import LocalModelRegistryService
from app.services.provider_admin_service import ProviderAdminService
from app.services.provider_probe_service import ProviderProbeService
from app.services.routing_admin_service import RoutingAdminService
from app.services.task_catalog_service import TaskCatalogService

ADMIN_API_PATH_PREFIX = "/admin/api"
ADMIN_SESSION_COOKIE_NAME = "llm_gateway_admin_session"
CSRF_HEADER_NAME = "X-Requested-With"
CSRF_HEADER_VALUE = "llm-gateway-dashboard"
_STATE_CHANGING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


# ----- Runtime and database -----


def get_runtime(request: Request) -> GatewayRuntime:
    """Return the runtime, or fail with 503 while starting up or shutting down."""
    runtime: GatewayRuntime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise GatewayNotReadyError()
    return runtime


RuntimeDependency = Annotated[GatewayRuntime, Depends(get_runtime)]


async def get_database_session(runtime: RuntimeDependency) -> AsyncIterator[AsyncSession]:
    """One session per request; services commit explicitly."""
    async with runtime.session_factory() as database_session:
        yield database_session


DatabaseSessionDependency = Annotated[AsyncSession, Depends(get_database_session)]


# ----- Services -----


def get_provider_admin_service(
    database_session: DatabaseSessionDependency, runtime: RuntimeDependency
) -> ProviderAdminService:
    """Provider/model administration bound to this request's session."""
    return ProviderAdminService(database_session, runtime.secret_cipher, runtime.routing_catalog)


def get_provider_probe_service(runtime: RuntimeDependency) -> ProviderProbeService:
    """Live provider checks using the shared HTTP client."""
    return ProviderProbeService(runtime.http_client, runtime.secret_cipher)


def get_routing_admin_service(
    database_session: DatabaseSessionDependency, runtime: RuntimeDependency
) -> RoutingAdminService:
    """Route/default-model administration bound to this request's session."""
    return RoutingAdminService(database_session, runtime.routing_catalog, runtime.circuit_breakers)


def get_analytics_service(database_session: DatabaseSessionDependency) -> AnalyticsService:
    """Dashboard queries bound to this request's session."""
    return AnalyticsService(database_session)


def get_chain_analytics_service(database_session: DatabaseSessionDependency) -> ChainAnalyticsService:
    """Chain-step analytics bound to this request's session."""
    return ChainAnalyticsService(database_session)


def get_task_catalog_service(database_session: DatabaseSessionDependency) -> TaskCatalogService:
    """The fixed task list bound to this request's session."""
    return TaskCatalogService(database_session)


def get_local_model_registry_service(
    database_session: DatabaseSessionDependency, runtime: RuntimeDependency
) -> LocalModelRegistryService:
    """Local deployment registration bound to this request's session."""
    return LocalModelRegistryService(database_session, runtime.secret_cipher, runtime.routing_catalog)


ProviderAdminServiceDependency = Annotated[ProviderAdminService, Depends(get_provider_admin_service)]
ProviderProbeServiceDependency = Annotated[ProviderProbeService, Depends(get_provider_probe_service)]
RoutingAdminServiceDependency = Annotated[RoutingAdminService, Depends(get_routing_admin_service)]
AnalyticsServiceDependency = Annotated[AnalyticsService, Depends(get_analytics_service)]
ChainAnalyticsServiceDependency = Annotated[ChainAnalyticsService, Depends(get_chain_analytics_service)]
TaskCatalogServiceDependency = Annotated[TaskCatalogService, Depends(get_task_catalog_service)]
LocalModelRegistryServiceDependency = Annotated[
    LocalModelRegistryService, Depends(get_local_model_registry_service)
]


# ----- Authentication -----


async def require_caller_api_key(
    runtime: RuntimeDependency,
    authorization: Annotated[str | None, Header()] = None,
    x_api_key: Annotated[str | None, Header()] = None,
) -> None:
    """Accept ``Authorization: Bearer <key>`` (OpenAI SDKs) or ``X-API-Key``; constant-time check."""
    provided_api_key = extract_caller_api_key(authorization, x_api_key)
    if not is_valid_caller_api_key(provided_api_key, runtime.settings.api_key.get_secret_value()):
        raise AuthenticationFailedError()


async def require_registration_api_key(
    runtime: RuntimeDependency,
    authorization: Annotated[str | None, Header()] = None,
    x_api_key: Annotated[str | None, Header()] = None,
) -> None:
    """Same header forms as callers, checked against the separate registration key."""
    provided_api_key = extract_caller_api_key(authorization, x_api_key)
    if not is_valid_caller_api_key(
        provided_api_key, runtime.settings.registration_api_key.get_secret_value()
    ):
        raise AuthenticationFailedError()


def require_csrf_header(request: Request) -> None:
    """Reject state-changing admin requests that lack the dashboard's custom header.

    Browsers cannot attach a custom header to a cross-site request without a CORS
    preflight, which this API never approves, so this blocks CSRF in addition to the
    ``SameSite=Strict`` session cookie.
    """
    if (
        request.method in _STATE_CHANGING_METHODS
        and request.headers.get(CSRF_HEADER_NAME) != CSRF_HEADER_VALUE
    ):
        raise HTTPException(status_code=403, detail=f"Missing {CSRF_HEADER_NAME}: {CSRF_HEADER_VALUE} header")


def _is_configured_admin_api_key(runtime: GatewayRuntime, provided_api_key: str) -> bool:
    """True when the key matches the configured admin API key (never when none is set)."""
    admin_api_key = runtime.settings.admin_api_key
    if admin_api_key is None:
        return False
    return is_valid_caller_api_key(provided_api_key, admin_api_key.get_secret_value())


def require_admin(
    request: Request,
    runtime: RuntimeDependency,
    authorization: Annotated[str | None, Header()] = None,
    x_api_key: Annotated[str | None, Header()] = None,
) -> None:
    """Accept the admin API key (service-to-service), else the session cookie plus CSRF header.

    A bearer key is not sent automatically by browsers, so it needs no CSRF header. A request
    that presents a key which does not match is rejected outright, never retried as a session.
    """
    provided_api_key = extract_caller_api_key(authorization, x_api_key)
    if provided_api_key is not None:
        if not _is_configured_admin_api_key(runtime, provided_api_key):
            raise AuthenticationFailedError()
        return
    require_admin_session(request, runtime)
    require_csrf_header(request)


def require_admin_session(request: Request, runtime: RuntimeDependency) -> AdminSession:
    """Return the signed-in admin or fail with 401."""
    admin_session = runtime.admin_session_signer.verify(request.cookies.get(ADMIN_SESSION_COOKIE_NAME))
    if admin_session is None or admin_session.username != runtime.settings.admin_username:
        raise HTTPException(status_code=401, detail="Not signed in")
    return admin_session


AdminSessionDependency = Annotated[AdminSession, Depends(require_admin_session)]
ADMIN_ROUTER_DEPENDENCIES = [Depends(require_admin)]
