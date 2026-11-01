"""Task catalog, model limits and capabilities, local-model endpoints, response cache.

* ``tasks``: the catalog of task names callers send as ``model``, seeded with the
  ADR 0008 tasks plus ``conversation_summary``. ``requires_vision`` restricts routing
  to vision-capable models; per-task response-cache settings live here too. Every
  existing route gets a catalog row, then ``task_routes.task_name`` references it.
* ``provider_models``: context window, maximum output, capabilities, machine-reported
  availability, and optional per-model endpoint overrides (used by local deployments).
* ``response_cache_entries``: exact-match cached completions with an expiry.
* ``request_metrics``: response-cache status and estimated savings per row.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (task_name, description, requires_vision) for every built-in task.
BUILTIN_TASKS = (
    ("document_parse", "Parse a scanned or complex document page into structured text.", True),
    ("table_extraction", "Extract a table from a page image.", True),
    ("equation_ocr", "Transcribe equations from a page image to LaTeX.", True),
    ("chart_description", "Describe a chart or figure from an image.", True),
    ("query_rewrite", "Rewrite the user's question into a standalone retrieval query.", False),
    ("answer_generation", "Answer the user from retrieved context.", False),
    ("eval_judge", "Grade answers in offline evaluations.", False),
    ("conversation_summary", "Summarise older chat turns into the rolling conversation memory.", False),
)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    _create_task_catalog()
    _extend_provider_models()
    _create_response_cache()
    op.add_column("request_metrics", sa.Column("response_cache_status", sa.String(8), nullable=True))
    op.add_column("request_metrics", sa.Column("cost_saved_usd", sa.Numeric(18, 8), nullable=True))


def _create_task_catalog() -> None:
    tasks_table = op.create_table(
        "tasks",
        sa.Column("task_name", sa.String(63), primary_key=True),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("requires_vision", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_builtin", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("response_cache_enabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("response_cache_ttl_seconds", sa.Integer(), server_default="3600", nullable=False),
        sa.Column("response_cache_sampled_requests", sa.Boolean(), server_default="false", nullable=False),
        *_timestamps(),
        sa.CheckConstraint("task_name ~ '^[a-z][a-z0-9_.-]{0,62}$'", name="tasks_task_name_is_slug"),
        sa.CheckConstraint(
            "response_cache_ttl_seconds BETWEEN 1 AND 2592000", name="tasks_cache_ttl_in_range"
        ),
    )
    op.bulk_insert(
        tasks_table,
        [
            {"task_name": name, "description": description, "requires_vision": vision, "is_builtin": True}
            for name, description, vision in BUILTIN_TASKS
        ],
    )
    op.execute(
        "INSERT INTO tasks (task_name, description) "
        "SELECT task_name, description FROM task_routes ON CONFLICT (task_name) DO NOTHING"
    )
    op.create_foreign_key(
        "task_routes_task_name_fkey",
        "task_routes",
        "tasks",
        ["task_name"],
        ["task_name"],
        ondelete="RESTRICT",
    )


def _extend_provider_models() -> None:
    op.add_column("provider_models", sa.Column("context_window_tokens", sa.Integer(), nullable=True))
    op.add_column("provider_models", sa.Column("max_output_tokens", sa.Integer(), nullable=True))
    op.add_column(
        "provider_models",
        sa.Column("capabilities", postgresql.JSONB(), server_default="[]", nullable=False),
    )
    op.add_column(
        "provider_models", sa.Column("is_available", sa.Boolean(), server_default="true", nullable=False)
    )
    op.add_column("provider_models", sa.Column("base_url_override", sa.String(2048), nullable=True))
    op.add_column("provider_models", sa.Column("api_protocol_override", sa.String(32), nullable=True))
    op.create_check_constraint(
        "provider_models_default_output_within_max",
        "provider_models",
        "default_max_output_tokens IS NULL OR max_output_tokens IS NULL "
        "OR default_max_output_tokens <= max_output_tokens",
    )
    op.create_check_constraint(
        "provider_models_api_protocol_override_is_known",
        "provider_models",
        "api_protocol_override IS NULL OR api_protocol_override IN "
        "('openai_chat_completions', 'openai_responses', 'anthropic_messages')",
    )


def _create_response_cache() -> None:
    op.create_table(
        "response_cache_entries",
        sa.Column("cache_key", sa.String(64), primary_key=True),
        sa.Column("task_name", sa.String(63), nullable=False),
        sa.Column(
            "model_pk",
            sa.BigInteger(),
            sa.ForeignKey("provider_models.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider_id", sa.String(63), nullable=False),
        sa.Column("model_id", sa.String(255), nullable=False),
        sa.Column("upstream_protocol", sa.String(32), nullable=False),
        sa.Column("chat_completion", postgresql.JSONB(), nullable=False),
        sa.Column("response_bytes", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Numeric(18, 8), nullable=True),
        sa.Column("hit_count", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("last_hit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_response_cache_entries_task_name", "response_cache_entries", ["task_name"])
    op.create_index("ix_response_cache_entries_expires_at", "response_cache_entries", ["expires_at"])
    op.create_index("ix_response_cache_entries_model_pk", "response_cache_entries", ["model_pk"])


def downgrade() -> None:
    op.drop_column("request_metrics", "cost_saved_usd")
    op.drop_column("request_metrics", "response_cache_status")
    op.drop_table("response_cache_entries")
    op.drop_constraint("provider_models_api_protocol_override_is_known", "provider_models")
    op.drop_constraint("provider_models_default_output_within_max", "provider_models")
    for column_name in (
        "api_protocol_override",
        "base_url_override",
        "is_available",
        "capabilities",
        "max_output_tokens",
        "context_window_tokens",
    ):
        op.drop_column("provider_models", column_name)
    op.drop_constraint("task_routes_task_name_fkey", "task_routes", type_="foreignkey")
    op.drop_table("tasks")
