"""The fixed task list: the built-in task names callers send as ``model``."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.persistence import configuration_repository
from app.schemas.task_catalog import TaskResponse
from app.services.record_mappers import task_to_response


class TaskCatalogService:
    """Use case behind ``GET /admin/api/tasks``. Tasks are seeded by migrations, never created at runtime."""

    def __init__(self, database_session: AsyncSession) -> None:
        self._database_session = database_session

    async def list_tasks(self) -> list[TaskResponse]:
        """Every task ordered by name, with whether it has a route."""
        task_routes = await configuration_repository.list_task_routes(self._database_session)
        routed_task_names = {task_route.task_name for task_route in task_routes}
        return [
            task_to_response(task, has_route=task.task_name in routed_task_names)
            for task in await configuration_repository.list_tasks(self._database_session)
        ]
