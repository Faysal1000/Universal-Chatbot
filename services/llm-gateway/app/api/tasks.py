"""Caller-facing task resolution: ``GET /v1/tasks`` and ``GET /v1/tasks/{task_name}``.

Callers budget prompts with these limits, e.g. ``rag`` keeps chat memory inside the
context window of whichever model will answer.
"""

from fastapi import APIRouter, Depends

from app.api.dependencies import RuntimeDependency, require_caller_api_key
from app.core.errors import NoModelAvailableError
from app.routing.task_routes import normalise_task_name
from app.schemas.tasks import TaskResolutionResponse
from app.services.task_resolution import describe_task_resolution

router = APIRouter(prefix="/v1", tags=["inference"], dependencies=[Depends(require_caller_api_key)])


@router.get("/tasks", response_model=list[TaskResolutionResponse])
async def list_task_resolutions(runtime: RuntimeDependency) -> list[TaskResolutionResponse]:
    """Every catalogued or routed task with its current models and limits."""
    routing_snapshot = await runtime.routing_catalog.current_snapshot()
    return [
        describe_task_resolution(routing_snapshot, task_name)
        for task_name in routing_snapshot.known_task_names
    ]


@router.get(
    "/tasks/{task_name}",
    response_model=TaskResolutionResponse,
    responses={503: {"description": "No usable model serves this task (and no default model is set)"}},
)
async def get_task_resolution(task_name: str, runtime: RuntimeDependency) -> TaskResolutionResponse:
    """The models that would serve ``task_name`` now, in order, and the limits all of them respect.

    Unknown task names resolve like ``/v1/chat/completions`` does: to the default model.
    """
    normalised_task_name = normalise_task_name(task_name)
    routing_snapshot = await runtime.routing_catalog.current_snapshot()
    task_resolution = describe_task_resolution(routing_snapshot, normalised_task_name)
    if not task_resolution.models:
        raise NoModelAvailableError(f"No usable model serves task '{normalised_task_name}'")
    return task_resolution
