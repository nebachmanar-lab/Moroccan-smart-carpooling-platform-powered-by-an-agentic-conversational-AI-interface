"""create rides, bookings, driver_preferences tables

Revision ID: 002_create_rides_bookings
Revises: 995fb88afb9d
Create Date: 2025-07-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ENUM

revision = "002_create_rides_bookings"
down_revision = "995fb88afb9d"
branch_labels = None
depends_on = None

def upgrade() -> None:
    # create enum types if they do not already exist
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ridestatus') THEN
                CREATE TYPE ridestatus AS ENUM ('ACTIVE', 'FULL', 'CANCELLED', 'COMPLETED');
            END IF;
        END$$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bookingstatus') THEN
                CREATE TYPE bookingstatus AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
            END IF;
        END$$;
        """
    )

    # --- rides ---
    op.create_table(
        "rides",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("driver_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("origin_city", sa.String(100), nullable=False),
        sa.Column("origin_address", sa.String(255), nullable=True),
        sa.Column("destination_city", sa.String(100), nullable=False),
        sa.Column("destination_address", sa.String(255), nullable=True),
        sa.Column("departure_datetime", sa.DateTime, nullable=False),
        sa.Column("total_seats", sa.Integer, nullable=False),
        sa.Column("available_seats", sa.Integer, nullable=False),
        sa.Column("price_per_seat", sa.Float, nullable=False),
        sa.Column("status", ENUM("ACTIVE", "FULL", "CANCELLED", "COMPLETED", name="ridestatus", create_type=False), nullable=False, server_default="ACTIVE"),

        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_rides_origin_city", "rides", ["origin_city"])
    op.create_index("ix_rides_destination_city", "rides", ["destination_city"])
    op.create_index("ix_rides_departure_datetime", "rides", ["departure_datetime"])
    op.create_index("ix_rides_driver_id", "rides", ["driver_id"])

    # --- bookings ---
    op.create_table(
        "bookings",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("ride_id", sa.String, sa.ForeignKey("rides.id", ondelete="CASCADE"), nullable=False),
        sa.Column("passenger_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", ENUM("PENDING", "CONFIRMED", "CANCELLED", name="bookingstatus", create_type=False), nullable=False, server_default="CONFIRMED"),

        sa.Column("message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_bookings_passenger_id", "bookings", ["passenger_id"])
    op.create_index("ix_bookings_ride_id", "bookings", ["ride_id"])

    # --- driver_preferences ---
    op.create_table(
        "driver_preferences",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("driver_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("smoking_allowed", sa.Boolean, server_default="false"),
        sa.Column("pets_allowed", sa.Boolean, server_default="false"),
        sa.Column("music_allowed", sa.Boolean, server_default="true"),
        sa.Column("talking_preference", sa.String(20), server_default="no_preference"),
        sa.Column("luggage_size", sa.String(20), server_default="medium"),
        sa.Column("air_conditioning", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

def downgrade() -> None:
    op.drop_table("driver_preferences")
    op.drop_index("ix_bookings_ride_id")
    op.drop_index("ix_bookings_passenger_id")
    op.drop_table("bookings")
    op.drop_index("ix_rides_driver_id")
    op.drop_index("ix_rides_departure_datetime")
    op.drop_index("ix_rides_destination_city")
    op.drop_index("ix_rides_origin_city")
    op.drop_table("rides")
    op.execute("DROP TYPE IF EXISTS ridestatus")
    op.execute("DROP TYPE IF EXISTS bookingstatus")