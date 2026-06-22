"""add performance indexes

Revision ID: 006_add_performance_indexes
Revises: d6ccfb937495
Create Date: 2026-06-22
"""
from alembic import op

revision = "006_add_performance_indexes"
down_revision = "d6ccfb937495"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_rides_driver_id",      "rides",    ["driver_id"])
    op.create_index("ix_rides_status",          "rides",    ["status"])
    op.create_index("ix_rides_departure_time",  "rides",    ["departure_time"])
    op.create_index("ix_bookings_ride_id",      "bookings", ["ride_id"])
    op.create_index("ix_bookings_passenger_id", "bookings", ["passenger_id"])
    op.create_index("ix_bookings_status",       "bookings", ["status"])
    op.create_index("ix_ratings_driver_id",     "ratings",  ["driver_id"])


def downgrade() -> None:
    op.drop_index("ix_ratings_driver_id",     "ratings")
    op.drop_index("ix_bookings_status",       "bookings")
    op.drop_index("ix_bookings_passenger_id", "bookings")
    op.drop_index("ix_bookings_ride_id",      "bookings")
    op.drop_index("ix_rides_departure_time",  "rides")
    op.drop_index("ix_rides_status",          "rides")
    op.drop_index("ix_rides_driver_id",       "rides")
