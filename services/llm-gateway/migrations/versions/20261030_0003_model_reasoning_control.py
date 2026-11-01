"""Per-model reasoning control: pass ``reasoning_effort`` on, or switch the chat template.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "provider_models",
        sa.Column("reasoning_control", sa.String(32), nullable=False, server_default="reasoning_effort"),
    )
    op.create_check_constraint(
        "provider_models_reasoning_control_is_known",
        "provider_models",
        "reasoning_control IN ('reasoning_effort', 'enable_thinking')",
    )


def downgrade() -> None:
    op.drop_constraint("provider_models_reasoning_control_is_known", "provider_models", type_="check")
    op.drop_column("provider_models", "reasoning_control")
