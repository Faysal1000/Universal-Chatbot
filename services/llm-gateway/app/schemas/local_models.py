"""Machine registration of ``services/local-llm`` deployments (``/v1/local-models``)."""

import re
from datetime import datetime

from pydantic import BaseModel, Field, SecretStr, field_validator

from app.core.identifiers import TASK_NAME_PATTERN
from app.core.model_capabilities import ModelCapability
from app.core.reasoning_control import ReasoningControl
from app.schemas.base import StrictRequestModel
from app.schemas.providers import REASONING_CONTROL_DESCRIPTION, ApiProtocolName, validate_base_url

_TASK_NAME_REGEX = re.compile(TASK_NAME_PATTERN)


class LocalModelRegistrationRequest(StrictRequestModel):
    """Register or update one ready deployment; repeating the same call changes nothing."""

    display_name: str | None = Field(default=None, max_length=200, examples=["Nemotron Parse"])
    base_url: str = Field(max_length=2048, examples=["http://local-llm:8000/v1"])
    api_protocol: ApiProtocolName = "openai_chat_completions"
    api_key: SecretStr | None = Field(
        default=None,
        max_length=8192,
        description="Bearer key the gateway sends to local-llm; stored encrypted on the Local models "
        "provider and shared by all deployments. Omit to keep the stored key.",
    )
    capabilities: list[ModelCapability] = Field(default_factory=list, max_length=8, examples=[["vision"]])
    reasoning_control: ReasoningControl | None = Field(
        default=None, description=f"{REASONING_CONTROL_DESCRIPTION}. Omit to keep the stored value."
    )
    context_window_tokens: int = Field(ge=1, le=10_000_000, examples=[8192])
    max_output_tokens: int | None = Field(default=None, ge=1, le=1_000_000, examples=[4096])
    default_for_tasks: list[str] = Field(
        default_factory=list,
        max_length=50,
        description="Catalogued tasks to route to this deployment if they have no route yet",
        examples=[["document_parse"]],
    )

    @field_validator("base_url")
    @classmethod
    def normalise_base_url(cls, base_url: str) -> str:
        """Validate and strip a trailing slash."""
        return validate_base_url(base_url)

    @field_validator("capabilities")
    @classmethod
    def deduplicate_capabilities(cls, capabilities: list[ModelCapability]) -> list[ModelCapability]:
        """Stored sorted and unique."""
        return sorted(set(capabilities))

    @field_validator("default_for_tasks")
    @classmethod
    def require_task_name_slugs(cls, task_names: list[str]) -> list[str]:
        """Each entry must be a task-name slug; duplicates are dropped."""
        invalid_names = [task_name for task_name in task_names if not _TASK_NAME_REGEX.fullmatch(task_name)]
        if invalid_names:
            raise ValueError(f"invalid task names: {', '.join(invalid_names)}")
        return sorted(set(task_names))


class LocalModelDeploymentResponse(BaseModel):
    """A registered deployment as the gateway routes to it."""

    deployment_name: str
    model_pk: int = Field(description="Use this ID in task routes and the default-model setting")
    qualified_name: str = Field(examples=["local-models/nemotron-parse"])
    display_name: str | None
    base_url: str
    api_protocol: ApiProtocolName
    capabilities: list[str]
    reasoning_control: ReasoningControl
    context_window_tokens: int | None
    max_output_tokens: int | None
    is_available: bool
    is_enabled: bool = Field(description="The admin's switch; a disabled deployment is never routed to")
    has_api_key: bool = Field(description="Whether the Local models provider has an upstream key stored")
    created_at: datetime
    updated_at: datetime


class LocalModelRegistrationResponse(LocalModelDeploymentResponse):
    """Result of a registration call."""

    was_created: bool
    claimed_default_routes: list[str] = Field(
        description="Tasks that had no route and are now routed to this deployment"
    )
