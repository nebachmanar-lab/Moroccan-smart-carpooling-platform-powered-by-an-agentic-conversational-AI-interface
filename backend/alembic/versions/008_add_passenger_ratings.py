"""add passenger_ratings table

Revision ID: 008_add_passenger_ratings
Revises: 007_add_ride_alerts
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa

revision = "008_add_passenger_ratings"
down_revision = "007_add_ride_alerts"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "passenger_ratings",
        sa.Column("id",           sa.String(), primary_key=True),
        sa.Column("ride_id",      sa.String(), sa.ForeignKey("rides.id",  ondelete="CASCADE"), nullable=False),
        sa.Column("driver_id",    sa.String(), sa.ForeignKey("users.id",  ondelete="CASCADE"), nullable=False),
        sa.Column("passenger_id", sa.String(), sa.ForeignKey("users.id",  ondelete="CASCADE"), nullable=False),
        sa.Column("stars",        sa.Integer(), nullable=False),
        sa.Column("comment",      sa.Text(),    nullable=True),
        sa.Column("created_at",   sa.DateTime(), nullable=True),
        sa.UniqueConstraint("ride_id", "driver_id", "passenger_id", name="uq_passenger_rating"),
    )
    op.create_index("ix_passenger_ratings_passenger_id", "passenger_ratings", ["passenger_id"])
    op.create_index("ix_passenger_ratings_driver_id",    "passenger_ratings", ["driver_id"])


def downgrade():
    op.drop_table("passenger_ratings")
