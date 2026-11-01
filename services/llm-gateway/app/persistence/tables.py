"""SQLAlchemy ORM tables owned by the gateway (database ``llm_gateway``).

Configuration tables (providers, models, tasks, task routes, settings) are small and
read-mostly.
``request_metrics`` is append-heavy and range-partitioned by month on ``started_at``;
it is created by the Alembic migration with raw DDL because the ORM cannot express
declarative partitioning. Its ORM mapping here is used for inserts and queries only.
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.core.identifiers import MAX_CHAIN_STEPS, PROVIDER_ID_PATTERN, TASK_NAME_PATTERN

USD_PER_MILLION_TOKENS = Numeric(14, 6)


class TableBase(DeclarativeBase):
    """Declarative base shared by every gateway table."""


class TimestampColumns:
    """``created_at`` / ``updated_at`` maintained by the database."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ProviderRecord(TimestampColumns, TableBase):
    """An upstream LLM endpoint (a vendor API, a relay, or a self-hosted server)."""

    __tablename__ = "providers"
    __table_args__ = (
        CheckConstraint(f"provider_id ~ '{PROVIDER_ID_PATTERN}'", name="provider_id_is_slug"),
        CheckConstraint(
            "api_protocol IN ('openai_chat_completions', 'openai_responses', 'anthropic_messages')",
            name="api_protocol_is_known",
        ),
    )

    provider_id: Mapped[str] = mapped_column(String(63), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    base_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    api_protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    # Fernet ciphertext; plaintext never touches the database or API responses.
    encrypted_api_key: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # Fernet ciphertext of a JSON object {header_name: header_value}.
    encrypted_extra_headers: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # Header names only, so the dashboard can list them without decrypting values.
    extra_header_names: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default="[]")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    request_timeout_seconds: Mapped[float] = mapped_column(Float, nullable=False, server_default="120")
    max_concurrent_requests: Mapped[int] = mapped_column(Integer, nullable=False, server_default="64")

    models: Mapped[list["ProviderModelRecord"]] = relationship(
        back_populates="provider",
        cascade="all, delete-orphan",
        order_by="ProviderModelRecord.model_id",
        lazy="selectin",
    )


class ProviderModelRecord(TimestampColumns, TableBase):
    """A model offered by a provider, with optional pricing for cost tracking."""

    __tablename__ = "provider_models"
    __table_args__ = (
        UniqueConstraint("provider_id", "model_id", name="provider_models_unique_model"),
        CheckConstraint(
            "default_max_output_tokens IS NULL OR max_output_tokens IS NULL "
            "OR default_max_output_tokens <= max_output_tokens",
            name="provider_models_default_output_within_max",
        ),
        CheckConstraint(
            "api_protocol_override IS NULL OR api_protocol_override IN "
            "('openai_chat_completions', 'openai_responses', 'anthropic_messages')",
            name="provider_models_api_protocol_override_is_known",
        ),
        CheckConstraint(
            "reasoning_control IN ('reasoning_effort', 'enable_thinking')",
            name="provider_models_reasoning_control_is_known",
        ),
        CheckConstraint(
            "breaker_failure_threshold IS NULL OR breaker_failure_threshold BETWEEN 1 AND 100",
            name="provider_models_breaker_failure_threshold_range",
        ),
        CheckConstraint(
            "breaker_cooldown_seconds IS NULL OR breaker_cooldown_seconds BETWEEN 1 AND 86400",
            name="provider_models_breaker_cooldown_seconds_range",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider_id: Mapped[str] = mapped_column(
        ForeignKey("providers.provider_id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The exact model identifier the provider expects, e.g. "deepseek-chat".
    model_id: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # Used when the caller omits max_tokens and the protocol requires it (Anthropic).
    default_max_output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Limits published to callers through ``GET /v1/tasks/{task}`` for prompt budgeting.
    context_window_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ModelCapability values, e.g. ["vision"].
    capabilities: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default="[]")
    # Machine-reported (local deployments); the admin's switch is ``is_enabled``.
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # Per-model endpoint, for providers whose models live at different URLs (local deployments).
    base_url_override: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    api_protocol_override: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # ReasoningControl: how ``reasoning_effort`` reaches the model (see app.core.reasoning_control).
    reasoning_control: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="reasoning_effort"
    )
    # Circuit breaker: skip the model for the cooldown after this many failed requests in a row.
    # NULL uses the gateway defaults (LLM_GATEWAY_CIRCUIT_BREAKER_*).
    breaker_failure_threshold: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    breaker_cooldown_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_price_usd_per_million_tokens: Mapped[Decimal | None] = mapped_column(USD_PER_MILLION_TOKENS)
    cached_input_price_usd_per_million_tokens: Mapped[Decimal | None] = mapped_column(USD_PER_MILLION_TOKENS)
    output_price_usd_per_million_tokens: Mapped[Decimal | None] = mapped_column(USD_PER_MILLION_TOKENS)

    provider: Mapped[ProviderRecord] = relationship(back_populates="models", lazy="joined")


class TaskRecord(TimestampColumns, TableBase):
    """A built-in task name callers send as ``model``; the migrations seed the fixed list."""

    __tablename__ = "tasks"
    __table_args__ = (CheckConstraint(f"task_name ~ '{TASK_NAME_PATTERN}'", name="tasks_task_name_is_slug"),)

    task_name: Mapped[str] = mapped_column(String(63), primary_key=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    requires_vision: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")


class TaskRouteRecord(TimestampColumns, TableBase):
    """Maps a caller task name (sent as ``model``) to an ordered chain of model steps."""

    __tablename__ = "task_routes"
    __table_args__ = (CheckConstraint(f"task_name ~ '{TASK_NAME_PATTERN}'", name="task_name_is_slug"),)

    task_name: Mapped[str] = mapped_column(
        ForeignKey("tasks.task_name", ondelete="RESTRICT", name="task_routes_task_name_fkey"),
        primary_key=True,
    )
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # Try the gateway-wide default model after the last step when it is not already in the chain.
    append_default_model: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    steps: Mapped[list["TaskRouteStepRecord"]] = relationship(
        back_populates="task_route",
        lazy="selectin",
        order_by="TaskRouteStepRecord.position",
        cascade="all, delete-orphan",
    )


class TaskRouteStepRecord(TableBase):
    """One step of a task's model chain: a model tried in ``position`` order."""

    __tablename__ = "task_route_steps"
    __table_args__ = (
        UniqueConstraint("task_name", "position", name="task_route_steps_unique_position"),
        UniqueConstraint("task_name", "model_pk", name="task_route_steps_unique_model"),
        CheckConstraint(f"position BETWEEN 1 AND {MAX_CHAIN_STEPS}", name="task_route_steps_position_range"),
        CheckConstraint(
            "max_attempts IS NULL OR max_attempts BETWEEN 1 AND 10",
            name="task_route_steps_max_attempts_range",
        ),
        CheckConstraint(
            "timeout_seconds IS NULL OR (timeout_seconds > 0 AND timeout_seconds <= 3600)",
            name="task_route_steps_timeout_range",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_name: Mapped[str] = mapped_column(
        ForeignKey("task_routes.task_name", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    # RESTRICT: a model in use by a chain cannot be deleted silently.
    model_pk: Mapped[int] = mapped_column(
        ForeignKey("provider_models.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Tries on this model before the next step; NULL uses LLM_GATEWAY_MAX_ATTEMPTS_PER_MODEL.
    max_attempts: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # Replaces the provider's request timeout for this step; NULL keeps the provider's.
    timeout_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    task_route: Mapped[TaskRouteRecord] = relationship(back_populates="steps")


class GatewaySettingsRecord(TimestampColumns, TableBase):
    """Single-row table with gateway-wide routing settings editable from the dashboard."""

    __tablename__ = "gateway_settings"
    __table_args__ = (CheckConstraint("singleton_id = 1", name="gateway_settings_single_row"),)

    singleton_id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, server_default="1")
    # Serves unknown tasks and is the last fallback for every task route.
    default_model_pk: Mapped[int | None] = mapped_column(
        ForeignKey("provider_models.id", ondelete="RESTRICT"), nullable=True
    )


class RequestMetricRecord(TableBase):
    """One row per model attempt-chain of an inbound request (append-only, partitioned).

    A request served by its primary model writes one row. A request that fell back
    writes one row for the failed primary (with its error and attempt count) and one
    for the fallback, both sharing ``request_id``. Provider and model are stored as
    text so history survives deletion of their configuration.
    """

    __tablename__ = "request_metrics"
    __table_args__ = (
        PrimaryKeyConstraint("started_at", "id", name="request_metrics_pkey"),
        Index("ix_request_metrics_model_time", "provider_id", "model_id", "started_at"),
        Index("ix_request_metrics_task_time", "task_name", "started_at"),
        Index("ix_request_metrics_request_id", "request_id"),
        Index(
            "ix_request_metrics_errors",
            "started_at",
            "error_class",
            postgresql_where=text("error_class IS NOT NULL"),
        ),
        {"postgresql_partition_by": "RANGE (started_at)"},
    )

    id: Mapped[int] = mapped_column(BigInteger, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    task_name: Mapped[str] = mapped_column(String(128), nullable=False)
    provider_id: Mapped[str] = mapped_column(String(63), nullable=False)
    model_id: Mapped[str] = mapped_column(String(255), nullable=False)
    inbound_protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    upstream_protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    is_stream: Mapped[bool] = mapped_column(Boolean, nullable=False)
    is_fallback: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # Status returned to the caller for this attempt-chain (499 = caller disconnected).
    http_status: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    error_class: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempt_count: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cached_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reasoning_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_to_first_token_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_duration_ms: Mapped[float] = mapped_column(Float, nullable=False)
    output_tokens_per_second: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(18, 8), nullable=True)
    # Prompt-cache discount on the provider's side.
    cost_saved_usd: Mapped[Decimal | None] = mapped_column(Numeric(18, 8), nullable=True)
    # Position in the task's model chain of this row's model (the default model counts as a step).
    chain_step: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # Steps reached so far, including this one and any skipped by an open circuit breaker.
    chain_steps_tried: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # Why the chain moved past the previous step: its error class, or "circuit_open".
    fallback_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
