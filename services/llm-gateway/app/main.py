"""FastAPI application factory.

Uvicorn runs this with ``factory=True`` (see ``app/__main__.py``), so importing the
module never reads the environment; tests build apps with explicit settings.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from app import __version__
from app.api import health, inference, local_models, tasks
from app.api.admin import analytics, providers, routing, session
from app.api.admin import tasks as admin_tasks
from app.api.error_handlers import register_error_handlers
from app.api.middleware import RequestBodySizeLimitMiddleware, RequestContextMiddleware
from app.core.config import Settings, get_settings
from app.core.logging_config import configure_logging
from app.runtime import open_gateway_runtime
from app.security.admin_passwords import is_valid_password_hash_format

logger = logging.getLogger(__name__)


def create_app(
    app_settings: Settings | None = None,
    upstream_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Build the ASGI application. ``upstream_transport`` lets tests fake providers."""
    settings = app_settings or get_settings()
    configure_logging(
        settings.log_level, settings.log_format, enable_access_log=settings.log_level == "DEBUG"
    )
    if not is_valid_password_hash_format(settings.admin_password_hash.get_secret_value()):
        raise ValueError(
            "LLM_GATEWAY_ADMIN_PASSWORD_HASH is not a valid hash; generate one with "
            "`python -m app.cli hash-password`"
        )

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.runtime = None
        async with open_gateway_runtime(settings, upstream_transport) as runtime:
            application.state.runtime = runtime
            logger.info(
                "LLM gateway ready", extra={"version": __version__, "environment": settings.environment}
            )
            try:
                yield
            finally:
                logger.info("LLM gateway shutting down")
                application.state.runtime = None

    application = FastAPI(
        title="LLM Gateway",
        description=(
            "Single middleware for every LLM call: OpenAI-compatible Chat Completions in, task-based "
            "routing, protocol translation, retries and fallback, and per-request metrics."
        ),
        version=__version__,
        lifespan=lifespan,
        docs_url="/docs" if settings.enable_api_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.enable_api_docs else None,
    )
    # Added last = outermost: request IDs are assigned before size limits run.
    application.add_middleware(RequestBodySizeLimitMiddleware, max_body_bytes=settings.max_request_body_bytes)
    application.add_middleware(RequestContextMiddleware)
    register_error_handlers(application)

    application.include_router(health.health_router)
    for router in (
        inference.router,
        tasks.router,
        local_models.router,
        session.router,
        providers.router,
        routing.router,
        admin_tasks.router,
        analytics.router,
    ):
        application.include_router(router)
    return application
