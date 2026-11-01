"""Caller-facing task resolution: which models serve a task and their token limits."""

from pydantic import BaseModel, Field

from app.routing.task_routes import CandidateRole


class TaskModelResponse(BaseModel):
    """One model that may serve the task, in the order the gateway tries them (its chain)."""

    step: int = Field(description="Position in the task's chain; the appended default model comes last")
    role: CandidateRole = Field(
        description="primary (step 1), fallback (a later step), or default (the gateway-wide default model)"
    )
    max_attempts: int | None = Field(description="Tries on this step; null = the gateway-wide attempt count")
    qualified_name: str = Field(examples=["openai/gpt-5-mini"])
    provider_id: str
    model_id: str
    context_window_tokens: int | None
    max_output_tokens: int | None
    capabilities: list[str]


class TaskLimitsResponse(BaseModel):
    """Limits that hold whichever model serves the request (the minimum over known values)."""

    context_window_tokens: int | None = Field(
        description="Prompt plus output must fit in this many tokens; null if no model declares it"
    )
    max_output_tokens: int | None = Field(
        description="Largest output any serving model allows; null if unknown"
    )


class TaskResolutionResponse(BaseModel):
    """How the gateway currently resolves a task name sent as ``model``."""

    task_name: str
    is_routed: bool = Field(description="False when no enabled route exists and the default model serves it")
    requires_vision: bool
    models: list[TaskModelResponse] = Field(
        description="Enabled, usable chain steps in the order they are tried"
    )
    limits: TaskLimitsResponse
