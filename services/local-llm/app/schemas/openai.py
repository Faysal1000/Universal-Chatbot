"""OpenAI Chat Completions request and response shapes served on ``/v1``.

Requests allow unknown fields so engine-specific sampling options (for example
llama.cpp's ``min_p``) pass through to the engine that understands them.
"""

import time
import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MessageRole = Literal["system", "developer", "user", "assistant", "tool"]
FinishReason = Literal["stop", "length", "cancelled"]


class ImageUrl(BaseModel):
    """An image reference; only ``data:`` URIs are accepted (no server-side fetches)."""

    url: str = Field(min_length=1)
    detail: str | None = None


class TextContentPart(BaseModel):
    """A text segment of a multi-part message."""

    type: Literal["text"]
    text: str


class ImageContentPart(BaseModel):
    """An image segment of a multi-part message."""

    type: Literal["image_url"]
    image_url: ImageUrl


ContentPart = Annotated[TextContentPart | ImageContentPart, Field(discriminator="type")]


class ChatMessage(BaseModel):
    """One conversation turn."""

    model_config = ConfigDict(extra="allow")

    role: MessageRole
    content: str | list[ContentPart] | None = None

    def text_parts(self) -> list[str]:
        """Every text segment of this message, in order."""
        if isinstance(self.content, str):
            return [self.content]
        if self.content is None:
            return []
        return [part.text for part in self.content if isinstance(part, TextContentPart)]

    def image_urls(self) -> list[str]:
        """Every image URL of this message, in order."""
        if not isinstance(self.content, list):
            return []
        return [part.image_url.url for part in self.content if isinstance(part, ImageContentPart)]


class StreamOptions(BaseModel):
    """Streaming options; ``include_usage`` adds a final usage-only chunk."""

    include_usage: bool = False


class ChatCompletionRequest(BaseModel):
    """``POST /v1/chat/completions`` body. ``model`` is the deployment name."""

    model_config = ConfigDict(extra="allow")

    model: str = Field(min_length=1, max_length=128)
    messages: list[ChatMessage] = Field(min_length=1, max_length=512)
    stream: bool = False
    stream_options: StreamOptions | None = None
    max_tokens: int | None = Field(default=None, ge=1)
    max_completion_tokens: int | None = Field(default=None, ge=1)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, gt=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=0)
    repetition_penalty: float | None = Field(default=None, gt=0.0, le=10.0)
    stop: str | list[str] | None = None
    seed: int | None = None
    chat_template_kwargs: dict[str, Any] | None = None

    @property
    def requested_max_tokens(self) -> int | None:
        """``max_completion_tokens`` (newer clients) wins over ``max_tokens``."""
        return self.max_completion_tokens or self.max_tokens

    @property
    def includes_stream_usage(self) -> bool:
        """True when a streamed response must end with a usage chunk."""
        return self.stream_options is not None and self.stream_options.include_usage

    def all_image_urls(self) -> list[str]:
        """Image URLs from every message, in conversation order."""
        return [image_url for message in self.messages for image_url in message.image_urls()]


class Usage(BaseModel):
    """Token accounting for one completion."""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int

    @classmethod
    def from_counts(cls, prompt_tokens: int, completion_tokens: int) -> "Usage":
        """Build usage with ``total_tokens`` derived from its parts."""
        return cls(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        )


class AssistantMessage(BaseModel):
    """The generated assistant turn."""

    role: Literal["assistant"] = "assistant"
    content: str


class Choice(BaseModel):
    """One completion choice (this service always returns exactly one)."""

    index: int = 0
    message: AssistantMessage
    finish_reason: FinishReason


class ChatCompletion(BaseModel):
    """Non-streamed ``chat.completion`` response."""

    id: str
    object: Literal["chat.completion"] = "chat.completion"
    created: int
    model: str
    choices: list[Choice]
    usage: Usage


class ModelCard(BaseModel):
    """One entry of ``GET /v1/models``."""

    id: str
    object: Literal["model"] = "model"
    created: int
    owned_by: str = "local-llm"


class ModelList(BaseModel):
    """``GET /v1/models`` response: every deployment that is ready to serve."""

    object: Literal["list"] = "list"
    data: list[ModelCard]


def new_completion_id() -> str:
    """OpenAI-style completion identifier."""
    return f"chatcmpl-{uuid.uuid4().hex}"


def unix_timestamp() -> int:
    """Seconds since the epoch, as OpenAI's ``created`` field."""
    return int(time.time())
