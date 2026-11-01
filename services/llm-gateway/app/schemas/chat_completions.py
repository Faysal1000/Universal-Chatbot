"""The inbound OpenAI Chat Completions request (what callers send)."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ChatMessage(BaseModel):
    """One conversation message. Extra fields (``tool_calls``, ``tool_call_id``, ``name``) pass through."""

    model_config = ConfigDict(extra="allow")

    role: Literal["system", "developer", "user", "assistant", "tool"]
    content: str | list[dict[str, Any]] | None = None


class ChatCompletionRequest(BaseModel):
    """OpenAI Chat Completions request. Unknown fields are forwarded to the provider when possible."""

    model_config = ConfigDict(extra="allow")

    model: str | None = Field(
        default=None,
        max_length=128,
        description="Task name (e.g. 'answer', 'query', 'sms'). Empty/unknown tasks use the default model.",
    )
    messages: list[ChatMessage] = Field(min_length=1, max_length=10_000)
    stream: bool = False
    stream_options: dict[str, Any] | None = None
