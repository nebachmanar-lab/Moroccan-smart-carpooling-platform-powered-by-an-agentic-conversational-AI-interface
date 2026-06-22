"""add seats_booked, total_price, cancelled_at to bookings

Revision ID: 004_add_booking_fields
Revises: 003_add_pickup_dropoff
Create Date: 2026-06-10
"""
from alembic import op
import sqlalchemy as sa

revision = "004_add_booking_fields"
down_revision = "003_add_pickup_dropoff"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("seats_booked", sa.Integer,  nullable=False, server_default="1"))
    op.add_column("bookings", sa.Column("total_price",  sa.Float,    nullable=False, server_default="0"))
    op.add_column("bookings", sa.Column("cancelled_at", sa.DateTime, nullable=True))


def downgrade() -> None:
    op.drop_column("bookings", "cancelled_at")
    op.drop_column("bookings", "total_price")
    op.drop_column("bookings", "seats_booked")
