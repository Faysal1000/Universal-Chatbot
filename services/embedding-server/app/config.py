"""Service configuration loaded from ``EMBEDDING_SERVER_*`` environment variables.

Every variable is namespaced with the ``EMBEDDING_SERVER_`` prefix so this service
can share a shell, ``.env`` file, or deployment environment with other monorepo
services without collisions. For example, the ``api_key`` field is read from
``EMBEDDING_SERVER_API_KEY``.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENVIRONMENT_VARIABLE_PREFIX = "EMBEDDING_SERVER_"
MINIMUM_API_KEY_LENGTH = 32

InferenceDevice = Literal["auto", "cuda", "cpu"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["text", "json"]
SUPPORTED_EMBEDDING_DIMENSIONS = frozenset({256, 512, 768})


class Settings(BaseSettings):
    """Validated, immutable runtime configuration for the embedding server."""

    model_config = SettingsConfigDict(
        env_prefix=ENVIRONMENT_VARIABLE_PREFIX,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        frozen=True,
    )

    # ----- Security & credentials -----
    # Required on purpose: the API must never start with an implicit or empty key.
    api_key: SecretStr
    huggingface_token: SecretStr | None = None

    # ----- HTTP server -----
    host: str = "0.0.0.0"  # noqa: S104 - containers must bind all interfaces.
    port: int = Field(default=8000, ge=1, le=65_535)
    enable_api_docs: bool = False
    max_request_body_bytes: int = Field(default=16 * 1024 * 1024, ge=1024)
    graceful_shutdown_timeout_seconds: float = Field(default=30, gt=0, le=600)

    # ----- Logging -----
    log_level: LogLevel = "INFO"
    log_format: LogFormat = "json"

    # ----- Model & hardware -----
    model_name: str = Field(default="google/embeddinggemma-2", min_length=1)
    # Pin to a commit SHA in production so a model push cannot silently change vectors.
    model_revision: str | None = None
    device: InferenceDevice = "auto"
    # None lets PyTorch choose; set this to the container CPU limit on CPU nodes.
    cpu_inference_threads: int | None = Field(default=None, ge=1, le=256)
    # Matryoshka truncation size; changing it needs a new rag index version.
    embedding_dimension: int = 768

    # ----- Dynamic batching & admission control -----
    inference_batch_size: int = Field(default=16, ge=1, le=256)
    batch_collection_window_milliseconds: int = Field(default=10, ge=0, le=1000)
    max_pending_items: int = Field(default=256, ge=1, le=10_000)
    request_timeout_seconds: float = Field(default=120, gt=0, le=1800)

    # ----- Input safety limits -----
    max_batch_items: int = Field(default=64, ge=1, le=256)
    max_text_characters: int = Field(default=24_000, ge=1, le=200_000)
    max_title_characters: int = Field(default=512, ge=1, le=4096)
    max_text_tokens: int = Field(default=7800, ge=16, le=32_768)
    max_image_bytes: int = Field(default=5 * 1024 * 1024, ge=1024)
    max_image_pixels: int = Field(default=25_000_000, ge=1_000_000)
    max_image_side_pixels: int = Field(default=2048, ge=256, le=8192)
    image_decode_concurrency: int = Field(default=4, ge=1, le=64)

    @field_validator("api_key")
    @classmethod
    def require_strong_api_key(cls, api_key: SecretStr) -> SecretStr:
        """Reject short or blank API keys so the service is never trivially guessable."""
        secret_value = api_key.get_secret_value()
        if len(secret_value.strip()) < MINIMUM_API_KEY_LENGTH:
            raise ValueError(
                f"{ENVIRONMENT_VARIABLE_PREFIX}API_KEY must be at least "
                f"{MINIMUM_API_KEY_LENGTH} non-whitespace characters long"
            )
        return api_key

    @field_validator("embedding_dimension")
    @classmethod
    def require_supported_embedding_dimension(cls, embedding_dimension: int) -> int:
        """Only Matryoshka sizes the model was trained for produce meaningful vectors."""
        if embedding_dimension not in SUPPORTED_EMBEDDING_DIMENSIONS:
            raise ValueError(
                f"{ENVIRONMENT_VARIABLE_PREFIX}EMBEDDING_DIMENSION must be one of "
                f"{sorted(SUPPORTED_EMBEDDING_DIMENSIONS)}"
            )
        return embedding_dimension

    @field_validator("model_revision", "huggingface_token", mode="before")
    @classmethod
    def treat_blank_as_unset(cls, raw_value: object) -> object:
        """Allow ``VAR=`` in ``.env`` files to mean "not configured"."""
        if isinstance(raw_value, str) and not raw_value.strip():
            return None
        return raw_value

    @model_validator(mode="after")
    def validate_cross_field_limits(self) -> "Settings":
        """Enforce relationships between limits that individual fields cannot express."""
        if self.max_image_bytes >= self.max_request_body_bytes:
            raise ValueError(
                f"{ENVIRONMENT_VARIABLE_PREFIX}MAX_IMAGE_BYTES must be smaller than "
                f"{ENVIRONMENT_VARIABLE_PREFIX}MAX_REQUEST_BODY_BYTES"
            )
        if self.max_batch_items > self.max_pending_items:
            raise ValueError(
                f"{ENVIRONMENT_VARIABLE_PREFIX}MAX_BATCH_ITEMS must not exceed "
                f"{ENVIRONMENT_VARIABLE_PREFIX}MAX_PENDING_ITEMS, otherwise a full-size "
                "batch request could never be admitted"
            )
        return self

    @property
    def base64_image_character_limit(self) -> int:
        """Maximum Base64 length that can decode to ``max_image_bytes`` bytes."""
        return ((self.max_image_bytes + 2) // 3) * 4


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings, parsing the environment exactly once."""
    return Settings()


settings = get_settings()
