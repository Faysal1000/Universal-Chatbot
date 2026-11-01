"""Fixed task list and no response cache.

* Tasks are the built-in list seeded in 0002, minus ``eval_judge``: custom tasks and their
  routes are deleted, and ``is_builtin`` goes away because every task is built in.
* The response cache is removed: ``response_cache_entries``, the cache policy columns on
  ``tasks`` and the cache columns on ``request_metrics``.

The downgrade restores the schema, not the deleted rows.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Custom tasks, and eval_judge, which only served the removed evaluation feature. Deleting a
    # route cascades to its steps.
    op.execute(
        "DELETE FROM task_routes WHERE task_name IN "
        "(SELECT task_name FROM tasks WHERE NOT is_builtin OR task_name = 'eval_judge')"
    )
    op.execute("DELETE FROM tasks WHERE NOT is_builtin OR task_name = 'eval_judge'")
    op.drop_constraint("tasks_cache_ttl_in_range", "tasks")
    for column_name in (
        "is_builtin",
        "response_cache_enabled",
        "response_cache_ttl_seconds",
        "response_cache_sampled_requests",
    ):
        op.drop_column("tasks", column_name)
    op.drop_table("response_cache_entries")
    op.drop_column("request_metrics", "response_cache_status")
    op.drop_column("request_metrics", "response_cache_served_bytes")


def downgrade() -> None:
    op.add_column("request_metrics", sa.Column("response_cache_served_bytes", sa.Integer(), nullable=True))
    op.add_column("request_metrics", sa.Column("response_cache_status", sa.String(8), nullable=True))
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
    op.add_column(
        "tasks",
        sa.Column("response_cache_sampled_requests", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "tasks", sa.Column("response_cache_ttl_seconds", sa.Integer(), server_default="3600", nullable=False)
    )
    op.add_column(
        "tasks", sa.Column("response_cache_enabled", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column("tasks", sa.Column("is_builtin", sa.Boolean(), server_default="true", nullable=False))
    op.create_check_constraint(
        "tasks_cache_ttl_in_range", "tasks", "response_cache_ttl_seconds BETWEEN 1 AND 2592000"
    )
    op.execute(
        "INSERT INTO tasks (task_name, description) "
        "VALUES ('eval_judge', 'Grade answers in offline evaluations.')"
    )
