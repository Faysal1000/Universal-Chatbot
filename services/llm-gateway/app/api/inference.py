"""Caller-facing OpenAI-compatible API: ``POST /v1/chat/completions`` and ``GET /v1/models``.

Any OpenAI SDK works by pointing ``base_url`` at ``http://<gateway>/v1`` and using the
gateway API key. The ``model`` field carries the caller's **task name**; the gateway
decides which real model serves it.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends

from app.api.dependencies import RuntimeDependency, require_caller_api_key
from app.core.errors import NoModelAvailableError
from app.core.logging_config import current_request_id
from app.inference.asgi_responses import CancelOnDisconnectResponse
from app.routing.task_routes import normalise_task_name
from app.schemas.chat_completions import ChatCompletionRequest

router = APIRouter(prefix="/v1", tags=["inference"], dependencies=[Depends(require_caller_api_key)])

_CHAT_COMPLETION_EXAMPLES: dict[str, Any] = {
    "non_streaming": {
        "summary": "Answer a question (non-streaming)",
        "value": {
            "model": "answer",
            "messages": [
                {"role": "system", "content": "Answer using only the provided context and cite sources."},
                {"role": "user", "content": "What is the refund window?"},
            ],
        },
    },
    "streaming": {
        "summary": "Stream an answer with usage in the final chunk",
        "value": {
            "model": "answer",
            "stream": True,
            "stream_options": {"include_usage": True},
            "messages": [{"role": "user", "content": "Summarise the onboarding guide in 3 bullets."}],
        },
    },
}


@router.post(
    "/chat/completions",
    response_model=None,
    responses={
        200: {
            "description": "A `chat.completion` object, or a `text/event-stream` of "
            "`chat.completion.chunk` events ending with `data: [DONE]` when `stream` is true. "
            "`X-LLM-Gateway-Provider`/`-Model`/`-Fallback`/`-Attempts` headers say which model served it."
        },
        400: {"description": "Invalid request, or the provider rejected the request content"},
        401: {"description": "Missing or wrong gateway API key"},
        429: {"description": "Provider rate limit persisted through retries and fallback"},
        502: {"description": "Provider error persisted through retries and fallback"},
        503: {"description": "No model configured for the task, or gateway at capacity"},
        504: {"description": "Provider timed out through retries and fallback"},
    },
)
async def create_chat_completion(
    chat_request: Annotated[ChatCompletionRequest, Body(openapi_examples=_CHAT_COMPLETION_EXAMPLES)],
    runtime: RuntimeDependency,
) -> CancelOnDisconnectResponse:
    """Route the task to its model, translate protocols, retry, fall back, and record metrics."""
    task_name = normalise_task_name(chat_request.model)
    routing_snapshot = await runtime.routing_catalog.current_snapshot()
    route_candidates = routing_snapshot.resolve(task_name)
    if not route_candidates:
        raise NoModelAvailableError(
            f"No enabled model is configured for task '{task_name}' and no usable default model is set. "
            "An admin can route the task (POST /admin/api/routes) or set a default model "
            "(PUT /admin/api/settings)"
        )
    return runtime.completion_service.create_response(
        chat_request.model_dump(exclude_unset=True),
        route_candidates,
        request_id=current_request_id.get() or "-",
        task_policy=routing_snapshot.policy_for(task_name),
    )


@router.get("/models")
async def list_models(runtime: RuntimeDependency) -> dict[str, Any]:
    """List the task names callers can send as ``model`` (enabled routes plus ``default``)."""
    routing_snapshot = await runtime.routing_catalog.current_snapshot()
    return {
        "object": "list",
        "data": [
            {"id": task_name, "object": "model", "created": 0, "owned_by": "llm-gateway"}
            for task_name in routing_snapshot.routable_task_names
        ],
    }
