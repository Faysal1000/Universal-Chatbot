"""Response-cache served bytes on metric rows (``bypass`` needs no schema change).

``request_metrics.response_cache_served_bytes``: bytes replayed on a response-cache hit,
so ``/admin/api/analytics/cache`` can report them per range and group. Adding a column to
the partitioned parent adds it to every partition.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("request_metrics", sa.Column("response_cache_served_bytes", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("request_metrics", "response_cache_served_bytes")
