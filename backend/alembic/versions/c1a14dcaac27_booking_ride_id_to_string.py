"""booking_ride_id_to_string

Revision ID: c1a14dcaac27
Revises: 7a2f1bcd884b
Create Date: 2026-06-19 10:18:40.038028

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a14dcaac27'
down_revision: Union[str, Sequence[str], None] = '7a2f1bcd884b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop FK and index on bookings.ride_id before altering type
    with op.batch_alter_table('bookings') as batch_op:
        batch_op.drop_constraint('bookings_ride_id_fkey', type_='foreignkey')
        batch_op.alter_column(
            'ride_id',
            existing_type=sa.Integer(),
            type_=sa.String(),
            postgresql_using='ride_id::varchar',
        )
        batch_op.create_foreign_key(
            'bookings_ride_id_fkey', 'rides', ['ride_id'], ['id'], ondelete='CASCADE'
        )


def downgrade() -> None:
    with op.batch_alter_table('bookings') as batch_op:
        batch_op.drop_constraint('bookings_ride_id_fkey', type_='foreignkey')
        batch_op.alter_column(
            'ride_id',
            existing_type=sa.String(),
            type_=sa.Integer(),
            postgresql_using='ride_id::integer',
        )
        batch_op.create_foreign_key(
            'bookings_ride_id_fkey', 'rides', ['ride_id'], ['id'], ondelete='CASCADE'
        )
