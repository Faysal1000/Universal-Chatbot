"""Value types shared by routing, protocol adapters, and the inference engine."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal

from app.core.reasoning_control import DEFAULT_REASONING_CONTROL, ReasoningControl

JsonObject = dict[str, Any]
ApiProtocol = Literal["openai_chat_completions", "openai_responses", "anthropic_messages"]
INBOUND_PROTOCOL: ApiProtocol = "openai_chat_completions"


@dataclass(frozen=True, slots=True)
class UpstreamTarget:
    """Everything needed to call one model, decrypted and detached from the database."""

    provider_id: str
    provider_display_name: str
    base_url: str
    api_protocol: ApiProtocol
    api_key: str | None
    extra_headers: dict[str, str]
    request_timeout_seconds: float
    max_concurrent_requests: int
    model_pk: int
    model_id: str
    default_max_output_tokens: int | None = None
    context_window_tokens: int | None = None
    max_output_tokens: int | None = None
    capabilities: frozenset[str] = frozenset()
    reasoning_control: ReasoningControl = DEFAULT_REASONING_CONTROL
    # Circuit-breaker overrides; ``None`` uses the gateway defaults.
    breaker_failure_threshold: int | None = None
    breaker_cooldown_seconds: int | None = None
    input_price_usd_per_million_tokens: Decimal | None = None
    cached_input_price_usd_per_million_tokens: Decimal | None = None
    output_price_usd_per_million_tokens: Decimal | None = None

    def has_capability(self, capability: str) -> bool:
        """Whether the model declares ``capability`` (e.g. ``"vision"``)."""
        return capability in self.capabilities

    @property
    def qualified_model_name(self) -> str:
        """``<provider_id>/<model_id>``, the gateway-wide unique model name."""
        return f"{self.provider_id}/{self.model_id}"

    def endpoint_url(self, path: str) -> str:
        """Join the provider base URL (e.g. ``https://api.example.com/v1``) with ``path``."""
        return f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"


@dataclass(slots=True)
class TokenUsage:
    """Token counts reported by the provider. ``None`` means "not reported"."""

    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    reasoning_tokens: int | None = None

    def to_chat_completions_usage(self) -> JsonObject:
        """Render as the ``usage`` object of a Chat Completions response."""
        prompt_tokens = self.input_tokens or 0
        completion_tokens = self.output_tokens or 0
        usage: JsonObject = {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        }
        if self.cached_input_tokens is not None:
            usage["prompt_tokens_details"] = {"cached_tokens": self.cached_input_tokens}
        if self.reasoning_tokens is not None:
            usage["completion_tokens_details"] = {"reasoning_tokens": self.reasoning_tokens}
        return usage


@dataclass(frozen=True, slots=True)
class PreparedUpstreamRequest:
    """A fully-built HTTP request to a provider."""

    url: str
    headers: dict[str, str]
    json_body: JsonObject


@dataclass(frozen=True, slots=True)
class DiscoveredModel:
    """A model ID returned by a provider's models endpoint."""

    model_id: str
    display_name: str | None = None
