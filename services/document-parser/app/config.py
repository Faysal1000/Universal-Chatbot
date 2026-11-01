"""Service configuration from ``DOCUMENT_PARSER_*`` environment variables.

Invalid configuration fails at start-up. Secrets are ``SecretStr`` so they never appear in
logs, reprs or error messages; ``redis_url`` is secret because it may embed a password.
"""

from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENVIRONMENT_VARIABLE_PREFIX = "DOCUMENT_PARSER_"

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["text", "json"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix=ENVIRONMENT_VARIABLE_PREFIX,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        frozen=True,
    )

    # ----- Queues (Redis) -----
    redis_url: SecretStr
    # Must match rag's RAG_REDIS_KEY_PREFIX: both sides share the BullMQ queues.
    queue_prefix: str = Field(default="rag", min_length=1)
    parse_inspect_concurrency: int = Field(default=2, ge=1, le=16)
    parse_pages_concurrency: int = Field(default=1, ge=1, le=16)
    lock_duration_seconds: int = Field(default=600, ge=30, le=3600)
    stalled_interval_seconds: int = Field(default=30, ge=5, le=600)
    graceful_shutdown_timeout_seconds: float = Field(default=60, gt=0, le=3600)

    # ----- Object storage (S3 / MinIO) -----
    s3_endpoint: AnyHttpUrl | None = None
    s3_region: str = "us-east-1"
    s3_bucket: str = Field(min_length=3, max_length=63)
    s3_access_key_id: str = Field(min_length=1)
    s3_secret_access_key: SecretStr
    s3_force_path_style: bool = True
    s3_timeout_seconds: float = Field(default=30, gt=0, le=600)
    maximum_source_bytes: int = Field(default=256 * 1024 * 1024, ge=1024)
    maximum_image_pixels: int = Field(default=150_000_000, ge=1_000_000)

    # ----- LLM gateway (vision model) -----
    llm_gateway_url: AnyHttpUrl
    llm_gateway_api_key: SecretStr
    gateway_max_attempts: int = Field(default=4, ge=1, le=10)
    gateway_initial_backoff_seconds: float = Field(default=2, gt=0, le=60)
    gateway_max_backoff_seconds: float = Field(default=30, gt=0, le=600)
    document_parse_max_tokens: int = Field(default=8744, ge=256, le=32_768)

    # ----- Parsing -----
    tesseract_languages: str = Field(default="eng+ben", pattern=r"^[a-z_]+(\+[a-z_]+)*$")
    ocr_render_dpi: int = Field(default=300, ge=72, le=600)
    minimum_ocr_seconds: float = Field(default=60, gt=0, le=3600)
    maximum_render_pixels: int = Field(default=40_000_000, ge=1_000_000)

    # ----- HTTP server (health probes) -----
    host: str = "0.0.0.0"  # noqa: S104 - containers must bind all interfaces.
    port: int = Field(default=8090, ge=1, le=65_535)
    readiness_timeout_seconds: float = Field(default=3, gt=0, le=60)

    # ----- Logging -----
    log_level: LogLevel = "INFO"
    log_format: LogFormat = "json"

    @field_validator("s3_endpoint", mode="before")
    @classmethod
    def treat_blank_as_unset(cls, raw_value: object) -> object:
        """Allow ``VAR=`` in ``.env`` files to mean "not configured"."""
        if isinstance(raw_value, str) and not raw_value.strip():
            return None
        return raw_value

    @field_validator("llm_gateway_api_key", "s3_secret_access_key", "redis_url")
    @classmethod
    def reject_blank_secret(cls, secret: SecretStr) -> SecretStr:
        if not secret.get_secret_value().strip():
            raise ValueError("must not be blank")
        return secret

    @property
    def lock_duration_milliseconds(self) -> int:
        return self.lock_duration_seconds * 1000
