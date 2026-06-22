"""add pickup and dropoff points to rides

Revision ID: 003_add_pickup_dropoff
Revises: 002_create_rides_bookings
Create Date: 2025-07-01
"""
from alembic import op
import sqlalchemy as sa

revision = "003_add_pickup_dropoff"
down_revision = "002_create_rides_bookings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rides", sa.Column("pickup_point",  sa.String(255), nullable=True))
    op.add_column("rides", sa.Column("dropoff_point", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("rides", "dropoff_point")
    op.drop_column("rides", "pickup_point")