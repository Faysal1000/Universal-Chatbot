"""Request and response contracts for the embedding API.

Size limits are read from settings at import time so they appear in the OpenAPI
schema and are enforced by Pydantic before any expensive work happens.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import settings

EmbeddingTask = Literal["none", "query", "document"]
# Deny-list, not a capability list: user text containing these special-token strings
# could inject fake media slots into the prompt. Only text and images are accepted;
# the audio tower is not loaded, and video is not an EmbeddingGemma 2 modality.
RESERVED_MULTIMODAL_MARKERS = ("<|image|>", "<|audio|>", "<|video|>")
_MINIMUM_BASE64_IMAGE_CHARACTERS = 16


def reject_unsafe_text(field_name: str, text_value: str) -> str:
    """Reject text that would corrupt the model prompt or downstream storage."""
    if "\x00" in text_value:
        raise ValueError(f"{field_name} must not contain NUL characters")
    if any(marker in text_value for marker in RESERVED_MULTIMODAL_MARKERS):
        raise ValueError(f"{field_name} must not contain reserved multimodal markers")
    return text_value


class StrictRequestModel(BaseModel):
    """Base for request bodies: unknown fields are errors, strings are trimmed."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, frozen=True)


class _TextFieldsMixin(StrictRequestModel):
    """Shared text, task, and title fields with their validation rules."""

    text: str = Field(min_length=1, max_length=settings.max_text_characters)
    task: EmbeddingTask = Field(
        default="none",
        description="'query' for search queries, 'document' for indexed passages, 'none' for raw text.",
    )
    title: str | None = Field(
        default=None,
        max_length=settings.max_title_characters,
        description="Optional document title; only valid when task='document'.",
    )

    @field_validator("text")
    @classmethod
    def validate_text(cls, text_value: str) -> str:
        """Ensure text is non-blank and free of reserved or unsafe characters."""
        if not text_value.strip():
            raise ValueError("text must not be empty or whitespace")
        return reject_unsafe_text("text", text_value)

    @field_validator("title")
    @classmethod
    def validate_title(cls, title_value: str | None) -> str | None:
        """Normalise blank titles to ``None`` and reject unsafe characters."""
        if title_value is None or not title_value.strip():
            return None
        return reject_unsafe_text("title", title_value)

    @model_validator(mode="after")
    def require_document_task_for_title(self) -> "_TextFieldsMixin":
        """A title only has meaning in the document prompt template."""
        if self.title is not None and self.task != "document":
            raise ValueError("title is only supported when task='document'")
        return self


ImageBase64Field = Annotated[
    str,
    Field(
        min_length=_MINIMUM_BASE64_IMAGE_CHARACTERS,
        max_length=settings.base64_image_character_limit,
        description="Raw standard Base64 (no data: URI prefix). JPEG, PNG, or static WEBP.",
    ),
]


class TextInput(_TextFieldsMixin):
    """Embed a passage of text."""

    type: Literal["text"]


class ImageInput(StrictRequestModel):
    """Embed a single image. URLs and server-side paths are intentionally unsupported."""

    type: Literal["image"]
    image_base64: ImageBase64Field


class TextImageInput(_TextFieldsMixin):
    """Embed text and an image jointly as one interleaved sequence."""

    type: Literal["text_image"]
    image_base64: ImageBase64Field


EmbeddingInput = Annotated[
    TextInput | ImageInput | TextImageInput,
    Field(discriminator="type"),
]


class BatchEmbeddingRequest(StrictRequestModel):
    """Embed up to ``max_batch_items`` heterogeneous items in one call."""

    items: list[EmbeddingInput] = Field(min_length=1, max_length=settings.max_batch_items)


class EmbeddingResponse(BaseModel):
    """A single L2-normalised embedding."""

    model: str
    model_revision: str | None
    dimension: int
    embedding: list[float]


class BatchEmbeddingResponse(BaseModel):
    """Embeddings in the same order as the request items."""

    model: str
    model_revision: str | None
    dimension: int
    count: int
    embeddings: list[list[float]]


class ErrorResponse(BaseModel):
    """Error body; ``item_index`` identifies the failing item in batch requests."""

    detail: str
    item_index: int | None = None
