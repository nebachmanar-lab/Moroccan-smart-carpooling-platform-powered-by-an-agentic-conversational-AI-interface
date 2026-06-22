"""add ride_alerts table

Revision ID: 007_add_ride_alerts
Revises: 006_add_performance_indexes
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa

revision = "007_add_ride_alerts"
down_revision = "006_add_performance_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ride_alerts",
        sa.Column("id",          sa.String(), nullable=False),
        sa.Column("user_id",     sa.String(), nullable=False),
        sa.Column("origin",      sa.String(), nullable=False),
        sa.Column("destination", sa.String(), nullable=False),
        sa.Column("is_active",   sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at",  sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ride_alerts_user_id", "ride_alerts", ["user_id"])
    op.create_index("ix_ride_alerts_active",  "ride_alerts", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_ride_alerts_active",  "ride_alerts")
    op.drop_index("ix_ride_alerts_user_id", "ride_alerts")
    op.drop_table("ride_alerts")
