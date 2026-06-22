"""add lat lng to rides

Revision ID: 004_add_lat_lng
Revises: 003_add_pickup_dropoff
Create Date: 2025-06-11

What this migration does:
  Adds 4 new columns to the rides table:
    - origin_lat      (decimal number, can be NULL)
    - origin_lng      (decimal number, can be NULL)
    - destination_lat (decimal number, can be NULL)
    - destination_lng (decimal number, can be NULL)

Run it with:
  alembic upgrade head
"""

from alembic import op
import sqlalchemy as sa

revision = "005_add_lat_lng_to_rides"
down_revision = "004_add_booking_fields"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("rides", sa.Column("origin_lat",      sa.Float(), nullable=True))
    op.add_column("rides", sa.Column("origin_lng",      sa.Float(), nullable=True))
    op.add_column("rides", sa.Column("destination_lat", sa.Float(), nullable=True))
    op.add_column("rides", sa.Column("destination_lng", sa.Float(), nullable=True))


def downgrade():
    # Removes the 4 columns if you need to roll back
    op.drop_column("rides", "destination_lng")
    op.drop_column("rides", "destination_lat")
    op.drop_column("rides", "origin_lng")
    op.drop_column("rides", "origin_lat")