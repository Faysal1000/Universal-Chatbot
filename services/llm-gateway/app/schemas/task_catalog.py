"""The fixed task list: the built-in task names callers send as ``model``."""

from datetime import datetime

from pydantic import BaseModel


class TaskResponse(BaseModel):
    """A built-in task and whether it has a route."""

    task_name: str
    description: str | None
    requires_vision: bool
    has_route: bool
    created_at: datetime
    updated_at: datetime
