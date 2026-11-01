"""Service configuration loaded from ``LOCAL_LLM_*`` environment variables.

Every variable is namespaced with the ``LOCAL_LLM_`` prefix so this service can share a
shell, ``.env`` file or deployment environment with other monorepo services. For example,
the ``admin_api_key`` field is read from ``LOCAL_LLM_ADMIN_API_KEY``.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENVIRONMENT_VARIABLE_PREFIX = "LOCAL_LLM_"
MINIMUM_API_KEY_LENGTH = 32
DEFAULT_PUBLIC_BASE_URL = "http://local-llm:8000"
GIBIBYTE = 1024**3
MEBIBYTE = 1024**2

DeviceRequest = Literal["auto", "gpu", "cpu"]
ModelDtype = Literal["auto", "bfloat16", "float16", "float32"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["text", "json"]


class Settings(BaseSettings):
    """Validated, immutable runtime configuration for the local-llm service."""

    model_config = SettingsConfigDict(
        env_prefix=ENVIRONMENT_VARIABLE_PREFIX,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        frozen=True,
    )

    # ----- Security & credentials -----
    # Required on purpose: neither API may start with an implicit or empty key.
    inference_api_key: SecretStr
    admin_api_key: SecretStr
    huggingface_token: SecretStr | None = None
    # Hugging Face organisations whose repositories may execute their own Python code on load.
    trusted_code_organizations: str = "nvidia"

    # ----- HTTP server -----
    host: str = "0.0.0.0"  # noqa: S104 - containers must bind all interfaces.
    port: int = Field(default=8000, ge=1, le=65_535)
    enable_api_docs: bool = False
    max_request_body_bytes: int = Field(default=16 * MEBIBYTE, ge=1024)
    graceful_shutdown_timeout_seconds: float = Field(default=30, gt=0, le=600)

    # ----- Logging -----
    log_level: LogLevel = "INFO"
    log_format: LogFormat = "json"

    # ----- State -----
    # Holds deployments.json; mount a volume so admin deployments survive restarts.
    state_directory: Path = Path("/var/lib/local-llm")

    # ----- System deployment (Nemotron Parse): always loaded, never removable -----
    system_deployment_name: str = Field(default="nemotron-parse", pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    system_model_id: str = Field(default="nvidia/Nemotron-3.5-Parse", min_length=3)
    # Pin to a commit SHA in production so a model push cannot silently change parsing.
    system_model_revision: str | None = None
    system_device: DeviceRequest = "auto"
    # auto = float32 on CPU (fastest there), bfloat16 on GPU.
    system_dtype: ModelDtype = "auto"
    # Model-card limits: vLLM serves it with a 16k window and dense pages need up to 8744 tokens.
    system_context_window_tokens: int = Field(default=16_384, ge=1024, le=1_048_576)
    system_max_output_tokens: int = Field(default=8744, ge=16, le=1_048_576)
    # Gateway tasks routed to the parser when they have no route yet (the admin's routes always win).
    system_default_for_tasks: str = "document_parse,table_extraction,equation_ocr,chart_description"

    # ----- Memory admission -----
    # Kept free for the operating system, Python and request buffers; never handed to models.
    memory_reserve_bytes: int = Field(default=1 * GIBIBYTE, ge=0)
    gpu_memory_reserve_bytes: int = Field(default=512 * MEBIBYTE, ge=0)
    # Override the detected RAM capacity (cgroup limit or physical RAM). Blank = detect.
    memory_capacity_bytes: int | None = Field(default=None, ge=256 * MEBIBYTE)
    default_context_window_tokens: int = Field(default=8192, ge=256, le=1_048_576)

    # ----- Document parser (Nemotron Parse) page size -----
    # Pages are downscaled (never upscaled) to this many pixels before parsing. Bounding boxes are
    # normalised, so callers are unaffected. 1.0 MP is an A4 page at ~100 DPI: body text stays legible
    # and CPU prefill drops ~4x versus 150 DPI. GPUs use the model's native maximum (1664x2048).
    parser_cpu_max_image_pixels: int = Field(default=1_000_000, ge=250_000, le=3_407_872)
    parser_gpu_max_image_pixels: int = Field(default=3_407_872, ge=250_000, le=3_407_872)

    # ----- Inference -----
    # PyTorch and llama.cpp threads on CPU. Blank = number of usable CPU cores.
    cpu_inference_threads: int | None = Field(default=None, ge=1, le=256)
    concurrent_requests_per_deployment: int = Field(default=1, ge=1, le=64)
    max_queued_requests_per_deployment: int = Field(default=8, ge=0, le=1000)
    request_timeout_seconds: float = Field(default=600, gt=0, le=3600)
    max_image_bytes: int = Field(default=10 * MEBIBYTE, ge=1024)
    max_image_pixels: int = Field(default=40_000_000, ge=1_000_000)
    throughput_window_seconds: int = Field(default=900, ge=60, le=86_400)

    # ----- llama.cpp (GGUF deployments) -----
    llama_server_binary: Path = Path("/opt/llama.cpp/llama-server")
    llama_server_startup_timeout_seconds: float = Field(default=300, gt=0, le=3600)

    # ----- llm-gateway registration (blank gateway URL = do not register) -----
    # On the platform network: http://llm-gateway:4000.
    gateway_base_url: str | None = None
    gateway_registration_api_key: SecretStr | None = None
    # How the gateway reaches this service; ``/v1`` is appended. The default is the platform service name.
    public_base_url: str = DEFAULT_PUBLIC_BASE_URL
    gateway_retry_max_backoff_seconds: float = Field(default=60, ge=1, le=3600)

    @field_validator("inference_api_key", "admin_api_key")
    @classmethod
    def require_strong_api_key(cls, api_key: SecretStr) -> SecretStr:
        """Reject short or blank API keys so neither API is trivially guessable."""
        if len(api_key.get_secret_value().strip()) < MINIMUM_API_KEY_LENGTH:
            raise ValueError(f"must be at least {MINIMUM_API_KEY_LENGTH} non-whitespace characters long")
        return api_key

    @field_validator(
        "system_model_revision",
        "huggingface_token",
        "gateway_base_url",
        "gateway_registration_api_key",
        "memory_capacity_bytes",
        "cpu_inference_threads",
        mode="before",
    )
    @classmethod
    def treat_blank_as_unset(cls, raw_value: object) -> object:
        """Allow ``VAR=`` in ``.env`` files to mean "not configured"."""
        if isinstance(raw_value, str) and not raw_value.strip():
            return None
        return raw_value

    @field_validator("gateway_base_url", "public_base_url")
    @classmethod
    def strip_trailing_slash(cls, url: str | None) -> str | None:
        """Require an http(s) URL and store it without a trailing slash."""
        if url is None:
            return None
        if not url.startswith(("http://", "https://")):
            raise ValueError("must start with http:// or https://")
        return url.rstrip("/")

    @model_validator(mode="after")
    def validate_cross_field_rules(self) -> "Settings":
        """Enforce relationships between settings that single fields cannot express."""
        if self.inference_api_key.get_secret_value() == self.admin_api_key.get_secret_value():
            raise ValueError(
                f"{ENVIRONMENT_VARIABLE_PREFIX}INFERENCE_API_KEY and "
                f"{ENVIRONMENT_VARIABLE_PREFIX}ADMIN_API_KEY must be different"
            )
        if self.gateway_base_url is not None and self.gateway_registration_api_key is None:
            raise ValueError(
                f"{ENVIRONMENT_VARIABLE_PREFIX}GATEWAY_BASE_URL requires "
                f"{ENVIRONMENT_VARIABLE_PREFIX}GATEWAY_REGISTRATION_API_KEY"
            )
        if self.max_image_bytes >= self.max_request_body_bytes:
            raise ValueError(
                f"{ENVIRONMENT_VARIABLE_PREFIX}MAX_IMAGE_BYTES must be smaller than "
                f"{ENVIRONMENT_VARIABLE_PREFIX}MAX_REQUEST_BODY_BYTES"
            )
        return self

    @property
    def trusted_code_organization_names(self) -> frozenset[str]:
        """Lower-cased organisation names allowed to run repository code."""
        return frozenset(
            organization.strip().lower()
            for organization in self.trusted_code_organizations.split(",")
            if organization.strip()
        )

    @property
    def system_default_task_names(self) -> tuple[str, ...]:
        """Task names the system deployment claims on the gateway."""
        return tuple(task.strip() for task in self.system_default_for_tasks.split(",") if task.strip())

    @property
    def is_gateway_registration_enabled(self) -> bool:
        """True when ready deployments should be registered with llm-gateway."""
        return self.gateway_base_url is not None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings, parsing the environment exactly once."""
    return Settings()
