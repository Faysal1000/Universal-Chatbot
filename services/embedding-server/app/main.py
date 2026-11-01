"""FastAPI application: lifecycle, authentication, routes, and error mapping."""

import asyncio
import hmac
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated

from fastapi import Body, Depends, FastAPI, HTTPException, Request, Security
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader

from app import __version__
from app.batching import DynamicBatcher
from app.config import Settings, settings
from app.errors import EmbeddingServerError, InvalidInputError
from app.logging_config import configure_logging
from app.middleware import RequestBodySizeLimitMiddleware, RequestContextMiddleware
from app.model import EmbeddingBackend, load_model
from app.openapi_examples import BATCH_EMBEDDING_EXAMPLES, SINGLE_EMBEDDING_EXAMPLES
from app.schemas import (
    BatchEmbeddingRequest,
    BatchEmbeddingResponse,
    EmbeddingInput,
    EmbeddingResponse,
    ErrorResponse,
)
from app.service import EmbeddingService

logger = logging.getLogger(__name__)

API_KEY_HEADER_NAME = "X-API-Key"
ModelLoader = Callable[[Settings], EmbeddingBackend]


@dataclass(frozen=True, slots=True)
class ServiceRuntime:
    """Objects that exist only between successful startup and shutdown."""

    embedding_backend: EmbeddingBackend
    batcher: DynamicBatcher
    embedding_service: EmbeddingService


def _get_runtime(request: Request) -> ServiceRuntime:
    runtime: ServiceRuntime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise HTTPException(status_code=503, detail="Embedding service is not ready")
    return runtime


def create_app(
    app_settings: Settings = settings,
    model_loader: ModelLoader = load_model,
) -> FastAPI:
    """Build the ASGI application. ``model_loader`` is injectable for tests."""
    configure_logging(app_settings.log_level, app_settings.log_format)

    expected_api_key_bytes = app_settings.api_key.get_secret_value().encode("utf-8")
    api_key_header = APIKeyHeader(name=API_KEY_HEADER_NAME, auto_error=False)

    async def require_api_key(
        provided_api_key: Annotated[str | None, Security(api_key_header)],
    ) -> None:
        """Constant-time API-key check; identical response for missing and wrong keys."""
        if provided_api_key is None or not hmac.compare_digest(
            provided_api_key.encode("utf-8"), expected_api_key_bytes
        ):
            raise HTTPException(
                status_code=401,
                detail="Invalid or missing API key",
                headers={"WWW-Authenticate": "ApiKey"},
            )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.runtime = None
        # Model loading blocks for a long time; keep the event loop responsive.
        embedding_backend = await asyncio.to_thread(model_loader, app_settings)
        batcher = DynamicBatcher(embedding_backend, app_settings)
        batcher.start()
        embedding_service = EmbeddingService(embedding_backend, batcher, app_settings)
        app.state.runtime = ServiceRuntime(embedding_backend, batcher, embedding_service)
        logger.info(
            "Embedding server ready",
            extra={
                "model_name": app_settings.model_name,
                "device": embedding_backend.device,
                "embedding_dimension": app_settings.embedding_dimension,
            },
        )
        try:
            yield
        finally:
            logger.info("Embedding server shutting down")
            await batcher.stop(drain_timeout_seconds=app_settings.graceful_shutdown_timeout_seconds)
            embedding_service.close()
            app.state.runtime = None

    application = FastAPI(
        title="Embedding Server",
        description="Multimodal (text, image, text+image) embeddings for retrieval.",
        version=__version__,
        lifespan=lifespan,
        docs_url="/docs" if app_settings.enable_api_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if app_settings.enable_api_docs else None,
    )
    # Added last = outermost: request IDs are assigned before size limits run.
    application.add_middleware(
        RequestBodySizeLimitMiddleware, max_body_bytes=app_settings.max_request_body_bytes
    )
    application.add_middleware(RequestContextMiddleware)

    @application.exception_handler(EmbeddingServerError)
    async def handle_embedding_server_error(request: Request, error: EmbeddingServerError) -> JSONResponse:
        if error.http_status >= 500:
            logger.warning(
                "Embedding request failed",
                extra={"error_type": type(error).__name__, "status_code": int(error.http_status)},
            )
        error_body = ErrorResponse(
            detail=error.client_message,
            item_index=error.item_index if isinstance(error, InvalidInputError) else None,
        )
        response_headers = (
            {"Retry-After": str(error.retry_after_seconds)} if error.retry_after_seconds is not None else None
        )
        return JSONResponse(
            status_code=int(error.http_status),
            content=error_body.model_dump(exclude_none=True),
            headers=response_headers,
        )

    error_responses: dict[int | str, dict[str, object]] = {
        status_code: {"model": ErrorResponse} for status_code in (401, 413, 422, 503, 504)
    }

    @application.get("/health/live", tags=["health"])
    async def liveness(request: Request) -> dict[str, str]:
        """Fails only if the worker crashed, so the orchestrator restarts a wedged process."""
        runtime: ServiceRuntime | None = getattr(request.app.state, "runtime", None)
        if runtime is not None and runtime.batcher.has_crashed:
            raise HTTPException(status_code=503, detail="Embedding worker crashed")
        return {"status": "alive"}

    @application.get("/health/ready", tags=["health"])
    async def readiness(request: Request) -> dict[str, str]:
        """Succeeds only when the model is loaded and the worker accepts work."""
        runtime: ServiceRuntime | None = getattr(request.app.state, "runtime", None)
        if runtime is None or not runtime.batcher.is_healthy:
            raise HTTPException(status_code=503, detail="Embedding service is not ready")
        return {"status": "ready"}

    @application.post(
        "/v1/embed",
        response_model=EmbeddingResponse,
        responses=error_responses,
        tags=["embeddings"],
        dependencies=[Depends(require_api_key)],
    )
    async def embed_single_item(
        item: Annotated[EmbeddingInput, Body(openapi_examples=SINGLE_EMBEDDING_EXAMPLES)],
        runtime: Annotated[ServiceRuntime, Depends(_get_runtime)],
    ) -> EmbeddingResponse:
        """Embed one text, image, or text+image item."""
        embedding_vectors = await runtime.embedding_service.embed_items([item])
        return EmbeddingResponse(
            model=app_settings.model_name,
            model_revision=app_settings.model_revision,
            dimension=app_settings.embedding_dimension,
            embedding=embedding_vectors[0],
        )

    @application.post(
        "/v1/embed/batch",
        response_model=BatchEmbeddingResponse,
        responses=error_responses,
        tags=["embeddings"],
        dependencies=[Depends(require_api_key)],
    )
    async def embed_batch_of_items(
        batch_request: Annotated[BatchEmbeddingRequest, Body(openapi_examples=BATCH_EMBEDDING_EXAMPLES)],
        runtime: Annotated[ServiceRuntime, Depends(_get_runtime)],
    ) -> BatchEmbeddingResponse:
        """Embed several items; embeddings are returned in request order."""
        embedding_vectors = await runtime.embedding_service.embed_items(batch_request.items)
        return BatchEmbeddingResponse(
            model=app_settings.model_name,
            model_revision=app_settings.model_revision,
            dimension=app_settings.embedding_dimension,
            count=len(embedding_vectors),
            embeddings=embedding_vectors,
        )

    return application


app = create_app()
