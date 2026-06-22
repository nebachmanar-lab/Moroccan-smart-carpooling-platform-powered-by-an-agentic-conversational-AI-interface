"""Add recurring ride fields and reports table

Revision ID: 009_add_recurring_and_reports
Revises: 008_add_passenger_ratings
Create Date: 2026-06-22

"""
from alembic import op
import sqlalchemy as sa

revision = "009_add_recurring_and_reports"
down_revision = "008_add_passenger_ratings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Recurring ride fields on rides table (C-08) ───────────────────────────
    op.add_column("rides", sa.Column("is_recurring", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("rides", sa.Column("recurrence_days", sa.JSON(), nullable=True))
    op.add_column("rides", sa.Column("recurrence_end_date", sa.DateTime(), nullable=True))

    # ── Reports table (ADM-01) ────────────────────────────────────────────────
    op.create_table(
        "reports",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("reporter_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("target_type", sa.String(20), nullable=False),   # "ride" | "user"
        sa.Column("target_id", sa.String(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_reports_reporter", "reports", ["reporter_id"])
    op.create_index("ix_reports_status", "reports", ["status"])
    op.create_index("ix_reports_target", "reports", ["target_type", "target_id"])


def downgrade() -> None:
    op.drop_index("ix_reports_target", "reports")
    op.drop_index("ix_reports_status", "reports")
    op.drop_index("ix_reports_reporter", "reports")
    op.drop_table("reports")
    op.drop_column("rides", "recurrence_end_date")
    op.drop_column("rides", "recurrence_days")
    op.drop_column("rides", "is_recurring")
