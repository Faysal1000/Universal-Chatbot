"""Providers and models. Secrets are write-only: responses expose ``has_api_key`` and
header names, never key or header values."""

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator

from app.core.identifiers import PROVIDER_ID_PATTERN
from app.core.model_capabilities import ModelCapability
from app.core.reasoning_control import DEFAULT_REASONING_CONTROL, ReasoningControl
from app.schemas.base import StrictRequestModel

ApiProtocolName = Literal["openai_chat_completions", "openai_responses", "anthropic_messages"]
_HEADER_NAME_PATTERN = re.compile(r"^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$")
# Headers the gateway sets itself; overriding them per provider would break auth or framing.
_RESERVED_HEADER_NAMES = frozenset({"content-type", "content-length", "host", "accept", "transfer-encoding"})
REASONING_CONTROL_DESCRIPTION = (
    "How reasoning_effort reaches the model: passed on as is (reasoning_effort), or as "
    "chat_template_kwargs.enable_thinking for chat templates with a thinking switch (enable_thinking)"
)
_BREAKER_THRESHOLD_FIELD = Field(
    default=None,
    ge=1,
    le=100,
    description="Consecutive failed requests that open the circuit breaker; null = gateway default",
)
_BREAKER_COOLDOWN_FIELD = Field(
    default=None,
    ge=1,
    le=86400,
    description="Seconds an open breaker skips the model; null = gateway default",
)
_PRICE_FIELD = Field(default=None, ge=0, le=100_000, description="USD per 1M tokens")
_CONTEXT_WINDOW_FIELD = Field(
    default=None, ge=1, le=10_000_000, description="Prompt plus output token limit, published to callers"
)
_MAX_OUTPUT_FIELD = Field(default=None, ge=1, le=1_000_000, description="Largest output the model allows")


def validate_base_url(base_url: str) -> str:
    """An http(s) URL without a trailing slash."""
    if not re.match(r"^https?://[^\s/$.?#].[^\s]*$", base_url):
        raise ValueError("must be an http(s) URL such as https://api.example.com/v1")
    return base_url.rstrip("/")


class ExtraHeaderInput(StrictRequestModel):
    """One extra header sent to the provider. ``value: null`` keeps the stored value."""

    name: str
    value: str | None = Field(default=None, max_length=8192)

    @field_validator("name")
    @classmethod
    def require_valid_header_name(cls, header_name: str) -> str:
        """HTTP token characters only; gateway-controlled headers are reserved."""
        if not _HEADER_NAME_PATTERN.fullmatch(header_name):
            raise ValueError("is not a valid HTTP header name")
        if header_name.lower() in _RESERVED_HEADER_NAMES:
            raise ValueError(f"'{header_name}' is set by the gateway and cannot be overridden")
        return header_name


class ProviderCreateRequest(StrictRequestModel):
    """Register a provider (the "Custom model API" form)."""

    provider_id: str = Field(pattern=PROVIDER_ID_PATTERN, examples=["deepseek"])
    display_name: str = Field(min_length=1, max_length=200)
    base_url: str = Field(max_length=2048, examples=["https://api.deepseek.com/v1"])
    api_protocol: ApiProtocolName
    api_key: SecretStr | None = Field(default=None, max_length=8192)
    extra_headers: list[ExtraHeaderInput] = Field(default_factory=list, max_length=50)
    is_enabled: bool = True
    request_timeout_seconds: float = Field(default=120, ge=1, le=1800)
    max_concurrent_requests: int = Field(default=64, ge=1, le=10_000)

    @field_validator("base_url")
    @classmethod
    def normalise_base_url(cls, base_url: str) -> str:
        """Validate and strip a trailing slash."""
        return validate_base_url(base_url)


class ProviderUpdateRequest(StrictRequestModel):
    """Partial update. Omitted fields are unchanged.

    ``api_key``: omit to keep, a value to replace, ``clear_api_key: true`` to remove.
    ``extra_headers``: omit to keep; when sent, it replaces the whole list, and an
    entry with ``value: null`` keeps that header's stored value.
    """

    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    base_url: str | None = Field(default=None, max_length=2048)
    api_protocol: ApiProtocolName | None = None
    api_key: SecretStr | None = Field(default=None, max_length=8192)
    clear_api_key: bool = False
    extra_headers: list[ExtraHeaderInput] | None = Field(default=None, max_length=50)
    is_enabled: bool | None = None
    request_timeout_seconds: float | None = Field(default=None, ge=1, le=1800)
    max_concurrent_requests: int | None = Field(default=None, ge=1, le=10_000)

    @field_validator("base_url")
    @classmethod
    def normalise_base_url(cls, base_url: str | None) -> str | None:
        """Validate and strip a trailing slash."""
        return validate_base_url(base_url) if base_url is not None else None


class ProviderModelCreateRequest(StrictRequestModel):
    """Add a model to a provider."""

    model_id: str = Field(min_length=1, max_length=255, examples=["deepseek-chat"])
    display_name: str | None = Field(default=None, max_length=200)
    is_enabled: bool = True
    default_max_output_tokens: int | None = Field(default=None, ge=1, le=1_000_000)
    context_window_tokens: int | None = _CONTEXT_WINDOW_FIELD
    max_output_tokens: int | None = _MAX_OUTPUT_FIELD
    capabilities: list[ModelCapability] = Field(default_factory=list, max_length=8, examples=[["vision"]])
    base_url_override: str | None = Field(
        default=None, max_length=2048, description="Call this URL instead of the provider's base URL"
    )
    api_protocol_override: ApiProtocolName | None = None
    reasoning_control: ReasoningControl = Field(
        default=DEFAULT_REASONING_CONTROL, description=REASONING_CONTROL_DESCRIPTION
    )
    breaker_failure_threshold: int | None = _BREAKER_THRESHOLD_FIELD
    breaker_cooldown_seconds: int | None = _BREAKER_COOLDOWN_FIELD
    input_price_usd_per_million_tokens: float | None = _PRICE_FIELD
    cached_input_price_usd_per_million_tokens: float | None = _PRICE_FIELD
    output_price_usd_per_million_tokens: float | None = _PRICE_FIELD

    @field_validator("base_url_override")
    @classmethod
    def normalise_base_url_override(cls, base_url: str | None) -> str | None:
        """Validate and strip a trailing slash."""
        return validate_base_url(base_url) if base_url is not None else None

    @field_validator("capabilities")
    @classmethod
    def deduplicate_capabilities(cls, capabilities: list[ModelCapability]) -> list[ModelCapability]:
        """Stored sorted and unique."""
        return sorted(set(capabilities))


class ProviderModelUpdateRequest(StrictRequestModel):
    """Partial update; send ``null`` explicitly to clear an optional field."""

    model_id: str | None = Field(default=None, min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=200)
    is_enabled: bool | None = None
    default_max_output_tokens: int | None = Field(default=None, ge=1, le=1_000_000)
    context_window_tokens: int | None = _CONTEXT_WINDOW_FIELD
    max_output_tokens: int | None = _MAX_OUTPUT_FIELD
    capabilities: list[ModelCapability] | None = Field(default=None, max_length=8)
    base_url_override: str | None = Field(default=None, max_length=2048)
    api_protocol_override: ApiProtocolName | None = None
    reasoning_control: ReasoningControl | None = Field(
        default=None, description=REASONING_CONTROL_DESCRIPTION
    )
    breaker_failure_threshold: int | None = _BREAKER_THRESHOLD_FIELD
    breaker_cooldown_seconds: int | None = _BREAKER_COOLDOWN_FIELD
    input_price_usd_per_million_tokens: float | None = _PRICE_FIELD
    cached_input_price_usd_per_million_tokens: float | None = _PRICE_FIELD
    output_price_usd_per_million_tokens: float | None = _PRICE_FIELD

    @field_validator("base_url_override")
    @classmethod
    def normalise_base_url_override(cls, base_url: str | None) -> str | None:
        """Validate and strip a trailing slash."""
        return validate_base_url(base_url) if base_url is not None else None

    @field_validator("capabilities")
    @classmethod
    def deduplicate_capabilities(
        cls, capabilities: list[ModelCapability] | None
    ) -> list[ModelCapability] | None:
        """Stored sorted and unique."""
        return sorted(set(capabilities)) if capabilities is not None else None


class ProviderModelResponse(BaseModel):
    """A configured model. ``id`` is the gateway's numeric model key used by routes."""

    id: int
    provider_id: str
    model_id: str
    qualified_name: str
    display_name: str | None
    is_enabled: bool
    default_max_output_tokens: int | None
    context_window_tokens: int | None
    max_output_tokens: int | None
    capabilities: list[str]
    is_available: bool = Field(description="Reported by the serving machine (local deployments)")
    base_url_override: str | None
    api_protocol_override: ApiProtocolName | None
    reasoning_control: ReasoningControl
    breaker_failure_threshold: int | None
    breaker_cooldown_seconds: int | None
    input_price_usd_per_million_tokens: float | None
    cached_input_price_usd_per_million_tokens: float | None
    output_price_usd_per_million_tokens: float | None
    created_at: datetime
    updated_at: datetime


class ProviderResponse(BaseModel):
    """A provider without any secret values."""

    provider_id: str
    display_name: str
    base_url: str
    api_protocol: ApiProtocolName
    has_api_key: bool
    extra_header_names: list[str]
    is_enabled: bool
    request_timeout_seconds: float
    max_concurrent_requests: int
    models: list[ProviderModelResponse]
    created_at: datetime
    updated_at: datetime


class DiscoveredModelResponse(BaseModel):
    """A model ID offered by the provider's models endpoint."""

    model_id: str
    display_name: str | None
    already_added: bool


class ConnectionTestResponse(BaseModel):
    """Outcome of a one-off test call (not recorded in request metrics)."""

    success: bool
    latency_ms: float
    http_status: int | None
    message: str
    response_preview: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
