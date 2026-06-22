"""verify_existing_users

Revision ID: 6070ebfc211f
Revises: bb5574cad9b0
Create Date: 2026-06-19 11:27:31.674633

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6070ebfc211f'
down_revision: Union[str, Sequence[str], None] = 'bb5574cad9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET is_verified = TRUE WHERE is_verified = FALSE")


def downgrade() -> None:
    pass
