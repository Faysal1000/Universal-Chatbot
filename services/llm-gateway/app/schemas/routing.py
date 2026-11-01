"""Task routes (ordered model chains), circuit breakers, and the gateway-wide default model."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.identifiers import MAX_CHAIN_STEPS, TASK_NAME_PATTERN
from app.schemas.base import StrictRequestModel

BreakerStatusName = Literal["closed", "open", "half_open"]


class ChainStepRequest(StrictRequestModel):
    """One step of a model chain; steps are tried in list order."""

    model_pk: int = Field(description="A model's `id` from GET /admin/api/providers")
    max_attempts: int | None = Field(
        default=1,
        ge=1,
        le=10,
        description="Tries on this model before the next step (retryable failures only, with backoff). "
        "null uses LLM_GATEWAY_MAX_ATTEMPTS_PER_MODEL.",
    )
    timeout_seconds: float | None = Field(
        default=None, gt=0, le=3600, description="Replaces the provider's request timeout for this step"
    )
    is_enabled: bool = Field(
        default=True, description="A disabled step stays in the chain but is never tried"
    )


class ModelChainRequest(StrictRequestModel):
    """A task's whole chain, replaced atomically: 1-10 steps, each model at most once."""

    steps: list[ChainStepRequest] = Field(min_length=1, max_length=MAX_CHAIN_STEPS)
    append_default_model: bool = Field(
        default=False,
        description="Try the gateway-wide default model after the last step "
        "when it is not already in the chain",
    )

    @field_validator("steps")
    @classmethod
    def reject_duplicate_models(cls, steps: list[ChainStepRequest]) -> list[ChainStepRequest]:
        """A model may appear only once per chain."""
        model_pks = [step.model_pk for step in steps]
        duplicate_model_pks = sorted({model_pk for model_pk in model_pks if model_pks.count(model_pk) > 1})
        if duplicate_model_pks:
            raise ValueError(f"models appear more than once: {', '.join(map(str, duplicate_model_pks))}")
        return steps


class TaskRouteCreateRequest(ModelChainRequest):
    """Route a task name (what the caller sends as ``model``) to a model chain."""

    task_name: str = Field(pattern=TASK_NAME_PATTERN, examples=["answer_generation"])
    description: str | None = Field(default=None, max_length=500)
    is_enabled: bool = True


class TaskRouteUpdateRequest(StrictRequestModel):
    """Partial update of route settings; the chain itself is replaced with PUT .../chain."""

    description: str | None = Field(default=None, max_length=500)
    is_enabled: bool | None = None
    append_default_model: bool | None = None


class ChainStepResponse(BaseModel):
    """A chain step with its model's display name and current circuit-breaker status."""

    position: int = Field(description="1-based order in the chain")
    model_pk: int
    model_name: str
    max_attempts: int | None
    timeout_seconds: float | None
    is_enabled: bool
    breaker_status: BreakerStatusName


class TaskRouteResponse(BaseModel):
    """A task route and its ordered model chain."""

    task_name: str
    description: str | None
    is_enabled: bool
    append_default_model: bool
    steps: list[ChainStepResponse]
    default_model_pk: int | None = Field(description="The appended default model, if any and if set")
    default_model_name: str | None
    created_at: datetime
    updated_at: datetime


class CircuitBreakerResponse(BaseModel):
    """A model's circuit breaker; only models with recent consecutive failures are listed."""

    model_pk: int
    model_name: str
    status: BreakerStatusName = Field(
        description="open: skipped until the cooldown ends; half_open: the next request is a trial"
    )
    consecutive_failures: int
    failure_threshold: int
    cooldown_seconds: int
    cooldown_remaining_seconds: float
    last_failure_at: datetime | None
    last_error_class: str | None
    opened_count: int


class CircuitBreakerResetResponse(BaseModel):
    """How many breakers were closed."""

    reset_count: int


class GatewaySettingsResponse(BaseModel):
    """Gateway-wide routing settings."""

    default_model_pk: int | None
    default_model_name: str | None


class GatewaySettingsUpdateRequest(StrictRequestModel):
    """Choose the default model (unknown tasks, last step of chains that append it); ``null`` clears it."""

    default_model_pk: int | None
