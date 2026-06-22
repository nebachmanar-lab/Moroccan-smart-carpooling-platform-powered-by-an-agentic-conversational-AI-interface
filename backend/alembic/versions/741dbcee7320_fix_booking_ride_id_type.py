"""fix_booking_ride_id_type

Revision ID: 741dbcee7320
Revises: 005_add_lat_lng_to_rides
Create Date: 2026-06-12 11:05:41.694627

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '741dbcee7320'
down_revision: Union[str, Sequence[str], None] = '005_add_lat_lng_to_rides'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Step 1: driver_preferences nullable constraints
    op.alter_column('driver_preferences', 'smoking_allowed',
               existing_type=sa.BOOLEAN(), nullable=False,
               existing_server_default=sa.text('false'))
    op.alter_column('driver_preferences', 'pets_allowed',
               existing_type=sa.BOOLEAN(), nullable=False,
               existing_server_default=sa.text('false'))
    op.alter_column('driver_preferences', 'music_allowed',
               existing_type=sa.BOOLEAN(), nullable=False,
               existing_server_default=sa.text('true'))
    op.alter_column('driver_preferences', 'talking_preference',
               existing_type=sa.VARCHAR(length=20), nullable=False,
               existing_server_default=sa.text("'no_preference'::character varying"))
    op.alter_column('driver_preferences', 'luggage_size',
               existing_type=sa.VARCHAR(length=20), nullable=False,
               existing_server_default=sa.text("'medium'::character varying"))
    op.alter_column('driver_preferences', 'air_conditioning',
               existing_type=sa.BOOLEAN(), nullable=False,
               existing_server_default=sa.text('true'))

    # ── Step 2: add new rides columns with temporary server defaults
    op.add_column('rides', sa.Column('origin',           sa.String(),   nullable=False, server_default=''))
    op.add_column('rides', sa.Column('destination',      sa.String(),   nullable=False, server_default=''))
    op.add_column('rides', sa.Column('departure_time',   sa.DateTime(), nullable=False, server_default=sa.text('now()')))
    op.add_column('rides', sa.Column('pickup_location',  sa.String(),   nullable=True))
    op.add_column('rides', sa.Column('dropoff_location', sa.String(),   nullable=True))

    # ── Step 3: copy data from old columns to new ones
    op.execute("UPDATE rides SET origin        = origin_city")
    op.execute("UPDATE rides SET destination   = destination_city")
    op.execute("UPDATE rides SET departure_time = departure_datetime")
    op.execute("UPDATE rides SET pickup_location  = pickup_point  WHERE pickup_point  IS NOT NULL")
    op.execute("UPDATE rides SET dropoff_location = dropoff_point WHERE dropoff_point IS NOT NULL")

    # Remove temporary server defaults
    op.alter_column('rides', 'origin',         server_default=None)
    op.alter_column('rides', 'destination',    server_default=None)
    op.alter_column('rides', 'departure_time', server_default=None)

    # ── Step 4: update rides.status nullable
    op.alter_column('rides', 'status',
               existing_type=postgresql.ENUM('ACTIVE', 'FULL', 'CANCELLED', 'COMPLETED', name='ridestatus'),
               nullable=True,
               existing_server_default=sa.text("'ACTIVE'::ridestatus"))

    # ── Step 5: drop old rides indexes (columns being dropped)
    op.drop_index(op.f('ix_rides_departure_datetime'), table_name='rides')
    op.drop_index(op.f('ix_rides_destination_city'),   table_name='rides')
    op.drop_index(op.f('ix_rides_driver_id'),          table_name='rides')
    op.drop_index(op.f('ix_rides_origin_city'),        table_name='rides')

    # Create new index for driver_id
    op.create_index(op.f('ix_rides_driver_id'), 'rides', ['driver_id'], unique=False)

    # ── Step 6: drop old rides columns
    op.drop_column('rides', 'origin_city')
    op.drop_column('rides', 'destination_city')
    op.drop_column('rides', 'departure_datetime')
    op.drop_column('rides', 'pickup_point')
    op.drop_column('rides', 'dropoff_point')
    op.drop_column('rides', 'origin_address')
    op.drop_column('rides', 'destination_address')
    op.drop_column('rides', 'notes')
    op.drop_column('rides', 'total_seats')
    op.drop_column('rides', 'updated_at')
    op.drop_column('rides', 'created_at')


def downgrade() -> None:
    # ── Restore old rides columns
    op.add_column('rides', sa.Column('total_seats',         sa.INTEGER(),           autoincrement=False, nullable=False, server_default='0'))
    op.add_column('rides', sa.Column('destination_address', sa.VARCHAR(length=255), autoincrement=False, nullable=True))
    op.add_column('rides', sa.Column('departure_datetime',  postgresql.TIMESTAMP(), autoincrement=False, nullable=False, server_default=sa.text('now()')))
    op.add_column('rides', sa.Column('created_at',          postgresql.TIMESTAMP(), server_default=sa.text('now()'), autoincrement=False, nullable=True))
    op.add_column('rides', sa.Column('updated_at',          postgresql.TIMESTAMP(), server_default=sa.text('now()'), autoincrement=False, nullable=True))
    op.add_column('rides', sa.Column('destination_city',    sa.VARCHAR(length=100), autoincrement=False, nullable=False, server_default=''))
    op.add_column('rides', sa.Column('origin_address',      sa.VARCHAR(length=255), autoincrement=False, nullable=True))
    op.add_column('rides', sa.Column('pickup_point',        sa.VARCHAR(length=255), autoincrement=False, nullable=True))
    op.add_column('rides', sa.Column('notes',               sa.TEXT(),              autoincrement=False, nullable=True))
    op.add_column('rides', sa.Column('dropoff_point',       sa.VARCHAR(length=255), autoincrement=False, nullable=True))
    op.add_column('rides', sa.Column('origin_city',         sa.VARCHAR(length=100), autoincrement=False, nullable=False, server_default=''))

    # Copy data back
    op.execute("UPDATE rides SET origin_city        = origin")
    op.execute("UPDATE rides SET destination_city   = destination")
    op.execute("UPDATE rides SET departure_datetime = departure_time")
    op.execute("UPDATE rides SET pickup_point  = pickup_location  WHERE pickup_location  IS NOT NULL")
    op.execute("UPDATE rides SET dropoff_point = dropoff_location WHERE dropoff_location IS NOT NULL")

    op.alter_column('rides', 'origin_city',        server_default=None)
    op.alter_column('rides', 'destination_city',   server_default=None)
    op.alter_column('rides', 'departure_datetime', server_default=None)
    op.alter_column('rides', 'total_seats',        server_default=None)

    op.drop_index(op.f('ix_rides_driver_id'), table_name='rides')
    op.create_index(op.f('ix_rides_origin_city'),        'rides', ['origin_city'],        unique=False)
    op.create_index(op.f('ix_rides_driver_id'),          'rides', ['driver_id'],          unique=False)
    op.create_index(op.f('ix_rides_destination_city'),   'rides', ['destination_city'],   unique=False)
    op.create_index(op.f('ix_rides_departure_datetime'), 'rides', ['departure_datetime'], unique=False)

    op.alter_column('rides', 'status',
               existing_type=postgresql.ENUM('ACTIVE', 'FULL', 'CANCELLED', 'COMPLETED', name='ridestatus'),
               nullable=False,
               existing_server_default=sa.text("'ACTIVE'::ridestatus"))

    op.drop_column('rides', 'dropoff_location')
    op.drop_column('rides', 'pickup_location')
    op.drop_column('rides', 'departure_time')
    op.drop_column('rides', 'destination')
    op.drop_column('rides', 'origin')

    # ── driver_preferences: restore nullable
    op.alter_column('driver_preferences', 'air_conditioning',
               existing_type=sa.BOOLEAN(), nullable=True, existing_server_default=sa.text('true'))
    op.alter_column('driver_preferences', 'luggage_size',
               existing_type=sa.VARCHAR(length=20), nullable=True,
               existing_server_default=sa.text("'medium'::character varying"))
    op.alter_column('driver_preferences', 'talking_preference',
               existing_type=sa.VARCHAR(length=20), nullable=True,
               existing_server_default=sa.text("'no_preference'::character varying"))
    op.alter_column('driver_preferences', 'music_allowed',
               existing_type=sa.BOOLEAN(), nullable=True, existing_server_default=sa.text('true'))
    op.alter_column('driver_preferences', 'pets_allowed',
               existing_type=sa.BOOLEAN(), nullable=True, existing_server_default=sa.text('false'))
    op.alter_column('driver_preferences', 'smoking_allowed',
               existing_type=sa.BOOLEAN(), nullable=True, existing_server_default=sa.text('false'))