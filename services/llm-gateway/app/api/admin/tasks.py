"""Admin API for the fixed task list (``/admin/api/tasks``)."""

from fastapi import APIRouter

from app.api.dependencies import (
    ADMIN_API_PATH_PREFIX,
    ADMIN_ROUTER_DEPENDENCIES,
    TaskCatalogServiceDependency,
)
from app.schemas.task_catalog import TaskResponse

router = APIRouter(
    prefix=ADMIN_API_PATH_PREFIX, tags=["admin: tasks"], dependencies=ADMIN_ROUTER_DEPENDENCIES
)


@router.get("/tasks", response_model=list[TaskResponse])
async def list_tasks(task_catalog: TaskCatalogServiceDependency) -> list[TaskResponse]:
    """Every built-in task with its vision need and whether it is routed."""
    return await task_catalog.list_tasks()
