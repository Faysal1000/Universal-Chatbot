"""Configurable model chains per task, circuit-breaker settings, chain metrics.

* ``task_route_steps``: each route's ordered chain (1-10 steps) with per-step attempts,
  timeout and enable switch. Existing routes convert with no behaviour change:
  primary only -> [primary] + default model appended; primary + fallback -> [primary,
  fallback] (no default, as before). Migrated steps keep the gateway-wide attempt count
  (``max_attempts`` NULL).
* ``task_routes.append_default_model`` replaces the implicit "no fallback = default" rule;
  ``primary_model_pk`` / ``fallback_model_pk`` are dropped.
* ``provider_models``: per-model circuit-breaker threshold and cooldown (NULL = defaults).
* ``request_metrics``: chain step, steps tried, and why the chain moved on.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    _create_route_steps_table()
    op.add_column(
        "task_routes",
        sa.Column("append_default_model", sa.Boolean(), server_default="false", nullable=False),
    )
    _convert_routes_to_chains()
    op.drop_column("task_routes", "fallback_model_pk")
    op.drop_column("task_routes", "primary_model_pk")
    _add_breaker_settings()
    op.add_column("request_metrics", sa.Column("chain_step", sa.SmallInteger(), nullable=True))
    op.add_column("request_metrics", sa.Column("chain_steps_tried", sa.SmallInteger(), nullable=True))
    op.add_column("request_metrics", sa.Column("fallback_reason", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("request_metrics", "fallback_reason")
    op.drop_column("request_metrics", "chain_steps_tried")
    op.drop_column("request_metrics", "chain_step")
    op.drop_constraint("provider_models_breaker_cooldown_seconds_range", "provider_models", type_="check")
    op.drop_constraint("provider_models_breaker_failure_threshold_range", "provider_models", type_="check")
    op.drop_column("provider_models", "breaker_cooldown_seconds")
    op.drop_column("provider_models", "breaker_failure_threshold")
    _restore_primary_and_fallback_columns()
    op.drop_column("task_routes", "append_default_model")
    op.drop_index("ix_task_route_steps_model_pk", table_name="task_route_steps")
    op.drop_index("ix_task_route_steps_task_name", table_name="task_route_steps")
    op.drop_table("task_route_steps")


def _create_route_steps_table() -> None:
    op.create_table(
        "task_route_steps",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "task_name",
            sa.String(63),
            sa.ForeignKey("task_routes.task_name", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column(
            "model_pk",
            sa.BigInteger(),
            sa.ForeignKey("provider_models.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("max_attempts", sa.SmallInteger(), nullable=True),
        sa.Column("timeout_seconds", sa.Float(), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.UniqueConstraint("task_name", "position", name="task_route_steps_unique_position"),
        sa.UniqueConstraint("task_name", "model_pk", name="task_route_steps_unique_model"),
        sa.CheckConstraint("position BETWEEN 1 AND 10", name="task_route_steps_position_range"),
        sa.CheckConstraint(
            "max_attempts IS NULL OR max_attempts BETWEEN 1 AND 10",
            name="task_route_steps_max_attempts_range",
        ),
        sa.CheckConstraint(
            "timeout_seconds IS NULL OR (timeout_seconds > 0 AND timeout_seconds <= 3600)",
            name="task_route_steps_timeout_range",
        ),
    )
    op.create_index("ix_task_route_steps_task_name", "task_route_steps", ["task_name"])
    op.create_index("ix_task_route_steps_model_pk", "task_route_steps", ["model_pk"])


def _convert_routes_to_chains() -> None:
    # The old resolver skipped a fallback equal to the primary and never added the default then.
    op.execute(
        "INSERT INTO task_route_steps (task_name, position, model_pk) "
        "SELECT task_name, 1, primary_model_pk FROM task_routes"
    )
    op.execute(
        "INSERT INTO task_route_steps (task_name, position, model_pk) "
        "SELECT task_name, 2, fallback_model_pk FROM task_routes "
        "WHERE fallback_model_pk IS NOT NULL AND fallback_model_pk <> primary_model_pk"
    )
    op.execute("UPDATE task_routes SET append_default_model = (fallback_model_pk IS NULL)")


def _add_breaker_settings() -> None:
    op.add_column("provider_models", sa.Column("breaker_failure_threshold", sa.SmallInteger(), nullable=True))
    op.add_column("provider_models", sa.Column("breaker_cooldown_seconds", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "provider_models_breaker_failure_threshold_range",
        "provider_models",
        "breaker_failure_threshold IS NULL OR breaker_failure_threshold BETWEEN 1 AND 100",
    )
    op.create_check_constraint(
        "provider_models_breaker_cooldown_seconds_range",
        "provider_models",
        "breaker_cooldown_seconds IS NULL OR breaker_cooldown_seconds BETWEEN 1 AND 86400",
    )


def _restore_primary_and_fallback_columns() -> None:
    """Keeps the first two steps (enabled or not); longer chains lose their tail."""
    for column_name in ("primary_model_pk", "fallback_model_pk"):
        op.add_column(
            "task_routes",
            sa.Column(
                column_name,
                sa.BigInteger(),
                sa.ForeignKey("provider_models.id", ondelete="RESTRICT"),
                nullable=True,
            ),
        )
    op.execute(
        "UPDATE task_routes SET primary_model_pk = step.model_pk FROM task_route_steps step "
        "WHERE step.task_name = task_routes.task_name AND step.position = 1"
    )
    op.execute(
        "UPDATE task_routes SET fallback_model_pk = step.model_pk FROM task_route_steps step "
        "WHERE step.task_name = task_routes.task_name AND step.position = 2"
    )
    # Without a second step, "no default model" was spelled fallback = primary.
    op.execute(
        "UPDATE task_routes SET fallback_model_pk = primary_model_pk "
        "WHERE fallback_model_pk IS NULL AND NOT append_default_model"
    )
    op.execute("DELETE FROM task_routes WHERE primary_model_pk IS NULL")
    op.alter_column("task_routes", "primary_model_pk", nullable=False)
