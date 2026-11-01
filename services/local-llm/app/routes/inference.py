"""OpenAI-compatible inference API (``/v1``) called by llm-gateway; ``model`` is the deployment name."""

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from app.deployments.models import DeploymentStatus
from app.errors import InvalidRequestError, ServiceShuttingDownError
from app.images import ImageLimits, validate_data_uri_image
from app.routes.dependencies import ManagerDependency
from app.schemas.openai import ChatCompletionRequest, ModelCard, ModelList
from app.security import KeyDependency

SSE_MEDIA_TYPE = "text/event-stream"


def build_inference_router(require_inference_key: KeyDependency, image_limits: ImageLimits) -> APIRouter:
    """Routes protected by the inference API key; errors use the OpenAI envelope."""
    router = APIRouter(prefix="/v1", tags=["inference"], dependencies=[Depends(require_inference_key)])

    @router.get("/models")
    async def list_models(manager: ManagerDependency) -> ModelList:
        """Deployments that are loaded and ready to serve."""
        return ModelList(
            data=[
                ModelCard(id=runtime.name, created=int(runtime.loaded_at.timestamp()) if runtime.loaded_at else 0)
                for runtime in manager.list_runtimes()
                if runtime.status is DeploymentStatus.READY
            ]
        )

    @router.post("/chat/completions", response_model=None)
    async def create_chat_completion(
        completion_request: ChatCompletionRequest,
        request: Request,
        manager: ManagerDependency,
    ) -> Response:
        """Generate a completion; ``stream: true`` returns Server-Sent Events ending with ``[DONE]``."""
        if request.app.state.is_shutting_down:
            raise ServiceShuttingDownError()
        runtime = manager.get_runtime(completion_request.model)
        managed_model = runtime.require_ready_model()
        _validate_images(completion_request, managed_model.loaded_model.is_vision, image_limits)
        request_scope = AsyncExitStack()
        try:
            await request_scope.enter_async_context(runtime.admission.slot())
            loaded_model = await request_scope.enter_async_context(managed_model.lease())
            observer = runtime.observe_request()
            if not completion_request.stream:
                completion = await loaded_model.complete(completion_request, observer)
                await request_scope.aclose()
                return JSONResponse(completion)
            event_stream = loaded_model.stream(completion_request, observer)
            # Pulling the first event surfaces validation errors as HTTP errors, not mid-stream events.
            first_event = await anext(event_stream)
        except BaseException:
            await request_scope.aclose()
            raise
        return StreamingResponse(
            _relay(first_event, event_stream, request_scope),
            media_type=SSE_MEDIA_TYPE,
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            # Runs even if the client disconnects before streaming starts, so the slot is never leaked.
            background=BackgroundTask(_close_stream, event_stream, request_scope),
        )

    return router


async def _relay(
    first_event: bytes, event_stream: AsyncIterator[bytes], request_scope: AsyncExitStack
) -> AsyncIterator[bytes]:
    try:
        yield first_event
        async for event in event_stream:
            yield event
    finally:
        await _close_stream(event_stream, request_scope)


async def _close_stream(event_stream: AsyncIterator[bytes], request_scope: AsyncExitStack) -> None:
    """Stop generation and release the slot and lease; safe to call twice."""
    aclose = getattr(event_stream, "aclose", None)
    if aclose is not None:
        await aclose()
    await request_scope.aclose()


def _validate_images(
    completion_request: ChatCompletionRequest, accepts_images: bool, image_limits: ImageLimits
) -> None:
    image_urls = completion_request.all_image_urls()
    if image_urls and not accepts_images:
        raise InvalidRequestError(f"Deployment '{completion_request.model}' does not accept images")
    for image_url in image_urls:
        validate_data_uri_image(image_url, image_limits)
