"""FastAPI application: composition root, lifecycle and error mapping."""

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.config import Settings, get_settings
from app.deployments.loader import ModelLoader
from app.deployments.manager import DeploymentManager
from app.deployments.memory import MemoryLedger, usable_devices_for_engine
from app.deployments.model_source import ModelSourceResolver
from app.deployments.models import EngineKind, ResolvedDevice
from app.deployments.store import DeploymentStore
from app.engines.base import Engine
from app.engines.llama_cpp_engine import LlamaCppEngine
from app.engines.transformers_engine import TransformersEngine
from app.errors import LocalLlmError, build_error_body
from app.gateway_registration import GatewayRegistrar
from app.hardware import default_inference_threads, list_cuda_gpus, llama_cpp_supports_cuda, ram_capacity_bytes
from app.images import ImageLimits
from app.logging_config import configure_logging, current_request_id
from app.middleware import RequestBodySizeLimitMiddleware, RequestContextMiddleware
from app.routes import health
from app.routes.admin import build_admin_router
from app.routes.inference import build_inference_router
from app.security import build_api_key_dependency

logger = logging.getLogger(__name__)

ManagerFactory = Callable[[Settings, MemoryLedger], DeploymentManager]
_HTTP_ERROR_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    413: "request_too_large",
    503: "unavailable",
}


def build_memory_ledger(settings: Settings) -> MemoryLedger:
    """Capacities per device: RAM (or the container limit) and the first GPU, minus the reserves."""
    capacities: dict[ResolvedDevice, int] = {
        "cpu": (settings.memory_capacity_bytes or ram_capacity_bytes()) - settings.memory_reserve_bytes
    }
    gpus = list_cuda_gpus()
    if gpus:
        capacities["cuda"] = gpus[0].total_memory_bytes - settings.gpu_memory_reserve_bytes
    return MemoryLedger(capacities)


def build_deployment_manager(settings: Settings, ledger: MemoryLedger) -> DeploymentManager:
    """Wire the real engines, Hugging Face resolver, state store and gateway registrar."""
    image_limits = ImageLimits(settings.max_image_bytes, settings.max_image_pixels)
    engines: dict[EngineKind, Engine] = {
        "transformers": TransformersEngine(
            image_limits,
            settings.request_timeout_seconds,
            {"cpu": settings.parser_cpu_max_image_pixels, "cuda": settings.parser_gpu_max_image_pixels},
        ),
        "llama_cpp": LlamaCppEngine(
            settings.llama_server_binary,
            settings.llama_server_startup_timeout_seconds,
            settings.request_timeout_seconds,
        ),
    }
    huggingface_token = settings.huggingface_token.get_secret_value() if settings.huggingface_token else None
    has_cuda = torch.cuda.is_available()
    has_llama_cpp_cuda = has_cuda and llama_cpp_supports_cuda(settings.llama_server_binary)
    return DeploymentManager(
        settings=settings,
        store=DeploymentStore(settings.state_directory),
        resolver=ModelSourceResolver(settings),
        loader=ModelLoader(engines, settings.cpu_inference_threads or default_inference_threads(), huggingface_token),
        ledger=ledger,
        registrar=GatewayRegistrar(settings),
        usable_devices=lambda engine: usable_devices_for_engine(engine, has_cuda, has_llama_cpp_cuda),
    )


def create_app(
    app_settings: Settings | None = None,
    manager_factory: ManagerFactory = build_deployment_manager,
) -> FastAPI:
    """Build the ASGI application; ``manager_factory`` is injectable for tests."""
    settings = app_settings or get_settings()
    configure_logging(settings.log_level, settings.log_format)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        ledger = build_memory_ledger(settings)
        manager = manager_factory(settings, ledger)
        app.state.memory_ledger = ledger
        app.state.deployment_manager = manager
        await manager.start()
        logger.info("local-llm started", extra={"version": __version__, "cuda": torch.cuda.is_available()})
        try:
            yield
        finally:
            app.state.is_shutting_down = True
            logger.info("local-llm shutting down")
            await manager.shutdown(settings.graceful_shutdown_timeout_seconds)

    application = FastAPI(
        title="local-llm",
        description="Self-hosted open-weight models (Nemotron Parse and admin deployments) behind llm-gateway.",
        version=__version__,
        lifespan=lifespan,
        docs_url="/docs" if settings.enable_api_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.enable_api_docs else None,
    )
    application.state.settings = settings
    application.state.is_shutting_down = False
    # Added last = outermost: request IDs are assigned before size limits run.
    application.add_middleware(RequestBodySizeLimitMiddleware, max_body_bytes=settings.max_request_body_bytes)
    application.add_middleware(RequestContextMiddleware)
    _register_error_handlers(application)

    image_limits = ImageLimits(settings.max_image_bytes, settings.max_image_pixels)
    application.include_router(health.router)
    application.include_router(
        build_inference_router(build_api_key_dependency(settings.inference_api_key, "Inference"), image_limits)
    )
    application.include_router(build_admin_router(build_api_key_dependency(settings.admin_api_key, "Admin")))
    return application


def _register_error_handlers(application: FastAPI) -> None:
    @application.exception_handler(LocalLlmError)
    async def handle_domain_error(request: Request, error: LocalLlmError) -> JSONResponse:
        headers = {"Retry-After": str(error.retry_after_seconds)} if error.retry_after_seconds else None
        return _error_response(
            request, int(error.http_status), error.error_code, error.client_message, error.details, headers
        )

    @application.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, error: StarletteHTTPException) -> JSONResponse:
        error_code = _HTTP_ERROR_CODES.get(error.status_code, "http_error")
        return _error_response(
            request, error.status_code, error_code, str(error.detail), None, dict(error.headers or {})
        )

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        # Field locations and messages only; never echo request content (it may contain images or prompts).
        problems = [f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}" for item in error.errors()]
        return _error_response(request, 422, "invalid_request", "; ".join(problems)[:1000], None, None)

    @application.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
        logger.exception("Unhandled error", extra={"path": request.url.path})
        return _error_response(request, 500, "internal_error", "Internal server error", None, None)


def _error_response(
    request: Request,
    status_code: int,
    error_code: str,
    message: str,
    details: dict[str, object] | None,
    headers: dict[str, str] | None,
) -> JSONResponse:
    error_body, media_type = build_error_body(
        request.url.path, status_code, error_code, message, current_request_id.get(), details
    )
    return JSONResponse(status_code=status_code, content=error_body, media_type=media_type, headers=headers)
