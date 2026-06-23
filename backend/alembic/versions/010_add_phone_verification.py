"""Add is_phone_verified to users

Revision ID: 010_add_phone_verification
Revises: 009_add_recurring_and_reports
Create Date: 2026-06-23

"""
from alembic import op
import sqlalchemy as sa

revision = "010_add_phone_verification"
down_revision = "009_add_recurring_and_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_phone_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "is_phone_verified")
