"""Service configuration loaded from ``LLM_GATEWAY_*`` environment variables.

Every variable is namespaced with the ``LLM_GATEWAY_`` prefix so this service can
share a shell, ``.env`` file, or deployment environment with other monorepo services
without collisions. For example, the ``api_key`` field is read from
``LLM_GATEWAY_API_KEY``.

Provider credentials are NOT configured here: they are managed in the admin
dashboard and stored encrypted in Postgres with ``encryption_key``.
"""

import base64
import binascii
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENVIRONMENT_VARIABLE_PREFIX = "LLM_GATEWAY_"
MINIMUM_SECRET_LENGTH = 32
FERNET_KEY_BYTES = 32

DeploymentEnvironment = Literal["development", "staging", "production"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["text", "json"]


class Settings(BaseSettings):
    """Validated, immutable runtime configuration for the LLM gateway."""

    model_config = SettingsConfigDict(
        env_prefix=ENVIRONMENT_VARIABLE_PREFIX,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        frozen=True,
    )

    # ----- Secrets -----
    # Required on purpose: the gateway must never start with an implicit or empty secret.
    api_key: SecretStr
    # Used only by services/local-llm to register its deployments (``/v1/local-models``).
    registration_api_key: SecretStr
    # Optional. Lets the admin console's backend call ``/admin/api`` with a bearer key
    # instead of the interactive session; unset means only the session is accepted.
    admin_api_key: SecretStr | None = None
    encryption_key: SecretStr
    database_url: SecretStr
    admin_username: str = Field(min_length=1, max_length=128)
    admin_password_hash: SecretStr
    admin_session_secret: SecretStr

    # ----- HTTP server -----
    host: str = "0.0.0.0"  # noqa: S104 - containers must bind all interfaces.
    port: int = Field(default=4000, ge=1, le=65_535)
    environment: DeploymentEnvironment = "production"
    enable_api_docs: bool = False
    # Chat requests may carry base64 images; 16 MiB leaves room for a few.
    max_request_body_bytes: int = Field(default=16 * 1024 * 1024, ge=1024)
    graceful_shutdown_timeout_seconds: float = Field(default=30, gt=0, le=600)

    # ----- Admin dashboard session -----
    admin_session_ttl_seconds: int = Field(default=12 * 3600, ge=300, le=30 * 24 * 3600)
    # Disable only for plain-HTTP local development; browsers drop Secure cookies over HTTP.
    admin_cookie_secure: bool = True
    admin_login_max_failures_per_minute: int = Field(default=5, ge=1, le=100)

    # ----- Logging -----
    log_level: LogLevel = "INFO"
    log_format: LogFormat = "json"

    # ----- Database -----
    database_pool_size: int = Field(default=10, ge=1, le=200)
    database_max_overflow: int = Field(default=10, ge=0, le=200)

    # ----- Upstream reliability -----
    # Attempts per model before moving to the fallback model (1 = no retries).
    max_attempts_per_model: int = Field(default=3, ge=1, le=10)
    # Circuit breaker defaults; each model can override both.
    circuit_breaker_failure_threshold: int = Field(default=5, ge=1, le=100)
    circuit_breaker_cooldown_seconds: int = Field(default=30, ge=1, le=86400)
    retry_base_delay_seconds: float = Field(default=0.5, ge=0, le=30)
    retry_max_delay_seconds: float = Field(default=8, ge=0, le=120)
    upstream_connect_timeout_seconds: float = Field(default=10, gt=0, le=120)
    # How long a request may wait for a free per-provider concurrency slot.
    concurrency_slot_wait_timeout_seconds: float = Field(default=10, ge=0, le=300)
    upstream_max_connections: int = Field(default=512, ge=1, le=10_000)
    # How long routing/provider configuration is cached between database reads.
    routing_cache_ttl_seconds: float = Field(default=5, ge=0, le=300)

    # ----- Request metrics storage -----
    metrics_retention_days: int = Field(default=180, ge=31, le=3650)
    metrics_write_batch_size: int = Field(default=500, ge=1, le=10_000)
    metrics_flush_interval_seconds: float = Field(default=1.0, gt=0, le=60)
    # Rows buffered in memory before new ones are dropped (and counted) instead of blocking.
    metrics_write_queue_capacity: int = Field(default=50_000, ge=100, le=1_000_000)

    @field_validator("api_key", "registration_api_key", "admin_api_key", "admin_session_secret")
    @classmethod
    def require_strong_secret(cls, secret: SecretStr | None) -> SecretStr | None:
        """Reject short or blank secrets so they are never trivially guessable."""
        if secret is None:
            return None
        if len(secret.get_secret_value().strip()) < MINIMUM_SECRET_LENGTH:
            raise ValueError(f"must be at least {MINIMUM_SECRET_LENGTH} non-whitespace characters long")
        return secret

    @field_validator("encryption_key")
    @classmethod
    def require_valid_fernet_key(cls, encryption_key: SecretStr) -> SecretStr:
        """The key must be a urlsafe-base64 encoded 32-byte Fernet key."""
        try:
            decoded_key = base64.urlsafe_b64decode(encryption_key.get_secret_value().encode("ascii"))
        except (binascii.Error, UnicodeEncodeError, ValueError) as decode_error:
            raise ValueError("must be a urlsafe-base64 Fernet key") from decode_error
        if len(decoded_key) != FERNET_KEY_BYTES:
            raise ValueError("must decode to exactly 32 bytes (generate with Fernet.generate_key())")
        return encryption_key

    @field_validator("database_url")
    @classmethod
    def require_asyncpg_database_url(cls, database_url: SecretStr) -> SecretStr:
        """The gateway uses async SQLAlchemy, which needs the asyncpg driver."""
        if not database_url.get_secret_value().startswith("postgresql+asyncpg://"):
            raise ValueError("must start with postgresql+asyncpg://")
        return database_url

    @model_validator(mode="after")
    def require_distinct_api_keys(self) -> "Settings":
        """A caller key must never be able to register models, and vice versa."""
        secrets = [self.api_key.get_secret_value(), self.registration_api_key.get_secret_value()]
        if self.admin_api_key is not None:
            secrets.append(self.admin_api_key.get_secret_value())
        if len(set(secrets)) != len(secrets):
            raise ValueError("api_key, registration_api_key and admin_api_key must all differ")
        return self

    @field_validator("admin_api_key", mode="before")
    @classmethod
    def treat_blank_as_unset(cls, raw_value: object) -> object:
        """Allow ``VAR=`` in ``.env`` files to mean "not configured"."""
        if isinstance(raw_value, str) and not raw_value.strip():
            return None
        return raw_value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings, parsing the environment exactly once."""
    return Settings()  # Required fields come from the environment.
